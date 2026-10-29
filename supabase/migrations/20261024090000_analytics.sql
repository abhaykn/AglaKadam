-- Progress over time, for the people who act on it.
--
--   * area_report: what a block or district office sees. Only totals, never a school, a class, a
--     teacher, a CRP or a child: a figure is shown only when it comes from five classes or more in
--     three schools or more (and, for mentoring, two CRPs or more), only for finished months, and
--     nothing is ranked. It measures mentoring by what changed, as the CRP workspace records it:
--       - visits that changed practice: of the follow-up visits, how many found the agreed step in
--         use;
--       - feedback actionability: the average rubric score of the feedback agreed;
--       - time to feedback: minutes from the end of the observed lesson to the agreed feedback;
--       - the Pulse trend: the classes' reading levels month by month, by class and medium, and for
--         Classes 2 and 3 the share of timed readers at NIPUN Bharat's Lakshya (45 and 60 words
--         correct a minute), a child who did not reach the passage counting as below it.
--   * child_progress and class_progress: what a teacher or CRP sees of the children they work
--     with, month by month. They read with the caller's own rights, so they show exactly what the
--     caller may already see.
--
-- A child's reading level is the most independent one: the CRP's own listening, then the engine's
-- sure score, then the teacher's.

-- ---------------------------------------------------------------------------------------------
-- The office's report
-- ---------------------------------------------------------------------------------------------

create function private.area_report(month_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Only finished months: figures of the month in progress would change from day to day, and
  -- comparing two days would show the one visit or check added in between.
  last_month date := (date_trunc('month', private.today()) - interval '1 month')::date;
  first_month date := (
    last_month - make_interval(months => greatest(1, least(coalesce(month_count, 6), 12)) - 1)
  )::date;
  -- A figure is shown only when it comes from enough classes, schools and (for mentoring) CRPs
  -- that no one of them can be made out.
  fewest_classes constant integer := 5;
  fewest_schools constant integer := 3;
  fewest_crps constant integer := 2;
  area_ids uuid[];
  result jsonb;
begin
  if private.is_super_admin() then
    select coalesce(array_agg(s.id), '{}') into area_ids
    from public.schools as s
    where s.is_active;
  else
    area_ids := private.officer_school_ids();
    if cardinality(area_ids) = 0 then
      return null;
    end if;
    select coalesce(array_agg(s.id), '{}') into area_ids
    from public.schools as s
    where s.is_active and s.id = any (area_ids);
  end if;

  with months as (
    select generate_series(first_month, last_month, interval '1 month')::date as month
  ),
  visits as (
    select v.id, v.class_section_id, v.school_id, v.crp_id,
      date_trunc('month', v.visited_on)::date as month,
      v.follows_visit_id, v.follow_up_result, f.agreed_at,
      -- A score counts only for the feedback as it was agreed when scored.
      case when sc.feedback_agreed_at = f.agreed_at then sc.total end as score,
      -- The end of the observed lesson is its last moment noted; without one it is unknown.
      v.started_at + make_interval(secs => last_moment.seconds) as lesson_end
    from public.visits as v
    left join public.visit_feedback as f on f.visit_id = v.id
    left join public.visit_feedback_scores as sc on sc.visit_id = v.id
    left join lateral (
      select max(m.at_seconds) as seconds
      from public.visit_moments as m
      where m.visit_id = v.id
    ) as last_moment on true
    where v.status = 'done'
      and v.school_id = any (area_ids)
      and v.visited_on between first_month and (last_month + interval '1 month' - interval '1 day')
  ),
  coaching as (
    select months.month,
      (select jsonb_build_object(
          'visits', count(*),
          'classes', count(distinct class_section_id))
       from visits
       where visits.month = months.month
       having count(distinct class_section_id) >= fewest_classes
         and count(distinct school_id) >= fewest_schools
         and count(distinct crp_id) >= fewest_crps) as visits_done,
      (select jsonb_build_object(
          'practised', count(*) filter (where follow_up_result = 'practised'),
          'partly', count(*) filter (where follow_up_result = 'partly'),
          'not_yet', count(*) filter (where follow_up_result = 'not_yet'))
       from visits
       where visits.month = months.month and follows_visit_id is not null
         and follow_up_result is not null
       having count(distinct class_section_id) >= fewest_classes
         and count(distinct school_id) >= fewest_schools
         and count(distinct crp_id) >= fewest_crps) as follow_ups,
      (select jsonb_build_object('average', round(avg(score), 1))
       from visits
       where visits.month = months.month and score is not null
       having count(distinct class_section_id) >= fewest_classes
         and count(distinct school_id) >= fewest_schools
         and count(distinct crp_id) >= fewest_crps) as feedback_score,
      (select jsonb_build_object(
          'median_minutes', round(percentile_cont(0.5) within group (
            order by greatest(0, extract(epoch from agreed_at - lesson_end) / 60))::numeric))
       from visits
       where visits.month = months.month and agreed_at is not null and lesson_end is not null
       having count(distinct class_section_id) >= fewest_classes
         and count(distinct school_id) >= fewest_schools
         and count(distinct crp_id) >= fewest_crps) as time_to_feedback
    from months
  ),
  -- The latest attempt of every drawn child of the area's classes, by month.
  checks as (
    select distinct on (k.sample_id)
      k.id, k.class_section_id, c.school_id, cy.month, cy.grade, cy.language, k.mode,
      k.reading_level
    from public.pulse_checks as k
    join public.pulse_samples as s on s.id = k.sample_id
    join public.pulse_cycles as cy on cy.id = s.cycle_id
    join public.class_sections as c on c.id = k.class_section_id
    where c.school_id = any (area_ids)
      and cy.month between first_month and last_month
    order by k.sample_id, k.attempt desc
  ),
  levels as (
    select ch.class_section_id, ch.school_id, ch.month, ch.grade, ch.language,
      coalesce(
        r.reading_level,
        case when p.check_id is not null and not sure.unsure then p.reading_level end,
        ch.reading_level
      ) as reading,
      (r.check_id is not null or (p.check_id is not null and not sure.unsure)) as independent,
      -- Timed: a recorded check the engine scored surely. A child who did not reach the passage
      -- has no speed and counts as below the Lakshya.
      (ch.mode = 'recorded' and p.check_id is not null and not sure.unsure) as timed,
      case
        when ch.mode = 'recorded' and p.reached_level = 'passage' and not sure.unsure
          then p.wcpm
      end as wcpm,
      case ch.grade when 2 then 45 when 3 then 60 end as lakshya
    from checks as ch
    left join public.pulse_reviews as r on r.check_id = ch.id
    left join public.pulse_scores as p on p.check_id = ch.id
    cross join lateral (
      select coalesce(p.flags && array['low_confidence', 'no_speech', 'quiet'], false) as unsure
    ) as sure
  ),
  pulse as (
    select l.month, l.grade, l.language,
      count(distinct l.class_section_id) as classes,
      count(distinct l.school_id) as schools,
      count(*) as checked,
      count(*) filter (where l.reading = 'needs_support') as needs_support,
      count(*) filter (where l.reading = 'hesitant') as hesitant,
      count(*) filter (where l.reading = 'fluent') as fluent,
      count(*) filter (where l.independent) as independent,
      count(*) filter (where l.timed) as timed,
      count(distinct l.class_section_id) filter (where l.timed) as timed_classes,
      count(distinct l.school_id) filter (where l.timed) as timed_schools,
      round((percentile_cont(0.5) within group (order by l.wcpm))::numeric) as wcpm_median,
      count(*) filter (where l.timed and l.wcpm >= l.lakshya) as at_lakshya,
      max(l.lakshya) as lakshya
    from levels as l
    group by l.month, l.grade, l.language
  )
  select jsonb_build_object(
    'fewest_classes', fewest_classes,
    'fewest_schools', fewest_schools,
    'fewest_crps', fewest_crps,
    'last_month', last_month,
    'schools', cardinality(area_ids),
    'classes', (
      select count(*)
      from public.class_sections as c
      join public.academic_years as y on y.id = c.academic_year_id
      where c.school_id = any (area_ids) and c.is_active
        and private.today() between y.starts_on and y.ends_on
    ),
    'coaching', coalesce((
      select jsonb_agg(jsonb_build_object(
          'month', coaching.month,
          'visits_done', coaching.visits_done,
          'follow_ups', coaching.follow_ups,
          'feedback_score', coaching.feedback_score,
          'time_to_feedback', coaching.time_to_feedback)
        order by coaching.month)
      from coaching
    ), '[]'::jsonb),
    'pulse', coalesce((
      select jsonb_agg(
        case
          when pulse.classes >= fewest_classes and pulse.schools >= fewest_schools then
            jsonb_build_object(
              'month', pulse.month, 'grade', pulse.grade, 'language', pulse.language,
              'withheld', false, 'classes', pulse.classes,
              'checked', pulse.checked,
              'needs_support', pulse.needs_support, 'hesitant', pulse.hesitant,
              'fluent', pulse.fluent, 'independent', pulse.independent,
              -- Speeds only from enough classes and schools of their own.
              'speed', case
                when pulse.lakshya is not null and pulse.timed_classes >= fewest_classes
                  and pulse.timed_schools >= fewest_schools
                then jsonb_build_object(
                  'timed', pulse.timed,
                  'median_wcpm', pulse.wcpm_median,
                  'at_lakshya', pulse.at_lakshya,
                  'lakshya', pulse.lakshya)
              end)
          else jsonb_build_object(
            'month', pulse.month, 'grade', pulse.grade, 'language', pulse.language,
            'withheld', true)
        end
        order by pulse.grade, pulse.language, pulse.month)
      from pulse
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function private.area_report(integer) from public;
grant execute on function private.area_report(integer) to authenticated, service_role;

-- The report for the signed-in office (or administrator) over the last months (6 by default, at
-- most 12); nothing for anyone else.
create function public.area_report(month_count integer default 6)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.area_report(month_count)
$$;

revoke all on function public.area_report(integer) from public, anon;
grant execute on function public.area_report(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A child's progress, as the caller may see it
-- ---------------------------------------------------------------------------------------------

create function public.child_progress(target_student_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with child as (
    select st.id, st.full_name, st.student_code
    from public.students as st
    where st.id = target_student_id
  ),
  checks as (
    select distinct on (s.id)
      k.id, cy.month, cy.grade, k.mode, k.reading_level, k.english_level
    from public.pulse_checks as k
    join public.pulse_samples as s on s.id = k.sample_id
    join public.pulse_cycles as cy on cy.id = s.cycle_id
    where k.student_id = target_student_id
    order by s.id, k.attempt desc
  ),
  pulse as (
    select ch.month, ch.grade,
      coalesce(
        r.reading_level,
        case when p.check_id is not null and not sure.unsure then p.reading_level end,
        ch.reading_level
      ) as reading,
      coalesce(
        r.english_level,
        case when p.check_id is not null and not sure.unsure then p.english_level end,
        ch.english_level
      ) as english,
      case
        when r.check_id is not null then 'review'
        when p.check_id is not null and not sure.unsure then 'engine'
        else 'teacher'
      end as source,
      case
        when ch.mode = 'recorded' and p.reached_level = 'passage' and not sure.unsure
          then round(p.wcpm::numeric)
      end as wcpm
    from checks as ch
    left join public.pulse_reviews as r on r.check_id = ch.id
    left join public.pulse_scores as p on p.check_id = ch.id
    cross join lateral (
      select coalesce(p.flags && array['low_confidence', 'no_speech', 'quiet'], false) as unsure
    ) as sure
  ),
  marks as (
    select pp.held_on, pp.subject, pp.subject_name, e.kind, e.title, m.absent,
      private.mark_percent(m.marks, m.grade, pp.max_marks) as percent
    from public.exam_marks as m
    join public.exam_papers as pp on pp.id = m.paper_id
    join public.exams as e on e.id = pp.exam_id
    where m.student_id = target_student_id
  ),
  days as (
    select a.attendance_date,
      bool_or(not (target_student_id = any (a.absent_student_ids))) as present
    from public.enrolments as en
    join public.attendance_sessions as a
      on a.class_section_id = en.class_section_id
      and a.attendance_date >= en.enrolled_on
      and (en.ended_on is null or a.attendance_date <= en.ended_on)
    where en.student_id = target_student_id
      and a.attendance_date >= private.today() - 400
    group by a.attendance_date
  )
  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', child.id, 'full_name', child.full_name, 'student_code', child.student_code),
    'pulse', coalesce((
      select jsonb_agg(jsonb_build_object(
          'month', pulse.month, 'grade', pulse.grade, 'reading', pulse.reading,
          'english', pulse.english, 'source', pulse.source, 'wcpm', pulse.wcpm)
        order by pulse.month)
      from pulse
    ), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object(
          'held_on', marks.held_on, 'subject', marks.subject, 'subject_name', marks.subject_name,
          'exam_kind', marks.kind, 'exam_title', marks.title, 'absent', marks.absent,
          'percent', marks.percent)
        order by marks.held_on, marks.subject)
      from marks
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'marked', marked, 'present', present)
        order by month)
      from (
        select date_trunc('month', days.attendance_date)::date as month,
          count(*) as marked, count(*) filter (where days.present) as present
        from days
        group by 1
      ) as by_month
    ), '[]'::jsonb)
  )
  from child
$$;

revoke all on function public.child_progress(uuid) from public, anon;
grant execute on function public.child_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A class's progress, as the caller may see it
-- ---------------------------------------------------------------------------------------------

create function public.class_progress(target_class_section_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with section_row as (
    select c.id, c.grade, y.starts_on
    from public.class_sections as c
    join public.academic_years as y on y.id = c.academic_year_id
    where c.id = target_class_section_id
  ),
  checks as (
    select distinct on (s.id)
      k.id, k.student_id, cy.month, k.mode, k.reading_level
    from public.pulse_checks as k
    join public.pulse_samples as s on s.id = k.sample_id
    join public.pulse_cycles as cy on cy.id = s.cycle_id
    where k.class_section_id = target_class_section_id
    order by s.id, k.attempt desc
  ),
  levels as (
    select ch.student_id, ch.month,
      coalesce(
        r.reading_level,
        case when p.check_id is not null and not sure.unsure then p.reading_level end,
        ch.reading_level
      ) as reading,
      case
        when ch.mode = 'recorded' and p.reached_level = 'passage' and not sure.unsure
          then round(p.wcpm::numeric)
      end as wcpm
    from checks as ch
    left join public.pulse_reviews as r on r.check_id = ch.id
    left join public.pulse_scores as p on p.check_id = ch.id
    cross join lateral (
      select coalesce(p.flags && array['low_confidence', 'no_speech', 'quiet'], false) as unsure
    ) as sure
  ),
  roll as (
    select en.student_id, st.full_name, en.enrolled_on
    from public.enrolments as en
    join public.students as st on st.id = en.student_id
    where en.class_section_id = target_class_section_id
      and en.ended_on is null
      and st.status <> 'left'
  ),
  sessions as (
    select a.attendance_date, a.absent_student_ids
    from public.attendance_sessions as a
    where a.class_section_id = target_class_section_id
      and a.attendance_date >= (select starts_on from section_row)
  ),
  recent_marks as (
    select m.student_id, avg(private.mark_percent(m.marks, m.grade, pp.max_marks)) as percent
    from public.exam_marks as m
    join public.exam_papers as pp on pp.id = m.paper_id
    where pp.class_section_id = target_class_section_id
      and not m.absent
      and pp.held_on >= private.today() - 90
    group by m.student_id
  )
  select jsonb_build_object(
    'grade', section_row.grade,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
          'month', month, 'checked', checked, 'fluent', fluent, 'hesitant', hesitant,
          'needs_support', needs_support)
        order by month)
      from (
        select levels.month, count(*) as checked,
          count(*) filter (where levels.reading = 'fluent') as fluent,
          count(*) filter (where levels.reading = 'hesitant') as hesitant,
          count(*) filter (where levels.reading = 'needs_support') as needs_support
        from levels
        group by levels.month
      ) as by_month
    ), '[]'::jsonb),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
          'student_id', roll.student_id,
          'full_name', roll.full_name,
          'latest', latest.reading,
          'latest_month', latest.month,
          'previous', previous.reading,
          'wcpm', latest.wcpm,
          'days_marked', (
            select count(*) from sessions where sessions.attendance_date >= roll.enrolled_on
          ),
          'days_present', (
            select count(*) from sessions
            where sessions.attendance_date >= roll.enrolled_on
              and not (roll.student_id = any (sessions.absent_student_ids))
          ),
          'marks_percent', round(recent_marks.percent, 1))
        order by roll.full_name)
      from roll
      left join lateral (
        select levels.reading, levels.month, levels.wcpm
        from levels where levels.student_id = roll.student_id
        order by levels.month desc limit 1
      ) as latest on true
      left join lateral (
        select levels.reading
        from levels where levels.student_id = roll.student_id and levels.month < latest.month
        order by levels.month desc limit 1
      ) as previous on true
      left join recent_marks on recent_marks.student_id = roll.student_id
    ), '[]'::jsonb)
  )
  from section_row
$$;

revoke all on function public.class_progress(uuid) from public, anon;
grant execute on function public.class_progress(uuid) to authenticated;
