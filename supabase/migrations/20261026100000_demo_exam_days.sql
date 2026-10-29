-- Demonstration districts: exam papers are written on school days.
--
-- A paper was dated by counting calendar days from the first day of its exam, so a Sunday or a
-- holiday inside the exam week got a paper too. Papers now fall one a day on the school days from
-- the first day, and the exam ends on the day of its last paper.

create or replace function private.demo_build_exams(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  first_month date;
  month_start date;
  exam_number integer := 0;
  this_exam uuid;
  starts date;
  first_cluster uuid;
  month_names constant text[] := array['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
  visitor_teacher uuid;
  year_id uuid;
  marks_written integer := 0;
  added integer;
  -- The school days from the first day of an exam: its papers are written one a day on them.
  exam_days date[];
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  first_month := date_trunc('month', sandbox.history_from)::date;
  select user_id into visitor_teacher from private.demo_accounts where sandbox_id = target_sandbox and role = 'teacher';
  select c.cluster_id into first_cluster from public.schools as c
  join private.demo_places as p on p.school_id = c.id
  where p.sandbox_id = target_sandbox and p.cluster_index = 1 limit 1;
  select cs.academic_year_id into year_id from public.class_sections as cs
  join private.demo_places as p on p.class_section_id = cs.id
  where p.sandbox_id = target_sandbox limit 1;

  for month_start in
    select m::date
    from generate_series(first_month, (date_trunc('month', sandbox.built_on) - interval '1 month')::date, interval '1 month') as m
    where extract(month from m) <> 6
    order by m desc
    limit 2
  loop
    exam_number := exam_number + 1;
    select min(d) into starts from private.demo_school_days(month_start + 17, month_start + 27) as d;
    continue when starts is null or starts < sandbox.history_from;
    perform set_config('agla.demo_today', starts::text, true);
    this_exam := private.demo_id(target_sandbox::text || ':exam:' || month_start::text);
    exam_days := array(select d from private.demo_school_days(starts, starts + 14) as d order by d limit 4);

    insert into public.exams (id, academic_year_id, kind, title, cluster_id, starts_on, ends_on, created_by, created_at, updated_at)
    values (
      this_exam, year_id, 'unit_test',
      'मासिक आकलन – ' || month_names[extract(month from month_start)::integer],
      first_cluster, starts, exam_days[4], private.demo_crp(target_sandbox, 1),
      private.demo_at(starts - 6, 690), private.demo_at(starts - 6, 690)
    );

    insert into public.exam_papers (id, exam_id, class_section_id, school_id, subject, held_on, scale, max_marks, created_at, updated_at)
    select private.demo_id(this_exam::text || p.class_section_id::text || subject.name), this_exam,
      p.class_section_id, p.school_id, subject.name, exam_days[subject.position], 'marks', 20,
      private.demo_at(starts - 5, 720), private.demo_at(starts - 5, 720)
    from private.demo_places as p
    cross join lateral (
      select name, position::integer
      from unnest(case when p.grade = 3 then array['hindi', 'english', 'maths', 'evs'] else array['hindi', 'english', 'maths'] end)
        with ordinality as subject (name, position)
    ) as subject
    where p.sandbox_id = target_sandbox and p.cluster_index = 1;

    insert into public.exam_marks (paper_id, student_id, marks, absent, entered_by, entered_at, updated_by, updated_at)
    select
      paper.id, e.student_id,
      case when not private.demo_absent(e.student_id, paper.class_section_id, paper.held_on) then
        round(2 * 20 * greatest(0.05, least(1.0,
          0.18
            + 0.62 * private.demo_rand(e.student_id::text || ':' || case paper.subject when 'english' then 'english' when 'hindi' then 'reading' else paper.subject end)
            + 0.08 - 0.06 * exam_number
            + (private.demo_rand(e.student_id::text || paper.id::text) - 0.5) * 0.24
        ))) / 2
      end,
      private.demo_absent(e.student_id, paper.class_section_id, paper.held_on),
      private.demo_class_teacher(paper.class_section_id),
      private.demo_at(paper.held_on + 2, 870),
      private.demo_class_teacher(paper.class_section_id),
      private.demo_at(paper.held_on + 2, 870)
    from public.exam_papers as paper
    join public.enrolments as e
      on e.class_section_id = paper.class_section_id
     and e.enrolled_on <= paper.held_on
     and (e.ended_on is null or e.ended_on >= paper.held_on)
    join public.students as st on st.id = e.student_id and st.status <> 'pending'
    where paper.exam_id = this_exam;
    get diagnostics added = row_count;
    marks_written := marks_written + added;

    -- The visitor teacher shared the older result with both classes' families, and the newer
    -- one with Class 3 so far.
    insert into public.exam_result_shares (exam_id, class_section_id, school_id, shared_by, shared_at)
    select this_exam, p.class_section_id, p.school_id, visitor_teacher, least(now(), private.demo_at(starts + 8, 1110))
    from private.demo_places as p
    where p.sandbox_id = target_sandbox and p.school_index = 1
      and (p.grade = 3 or (p.grade = 2 and exam_number = 2));
  end loop;

  -- This month's class test in the visitor teacher's classes: Hindi marked, Maths still to do.
  select min(d) into starts from private.demo_school_days(sandbox.built_on - 6, sandbox.built_on - 1) as d;
  if starts is not null and extract(day from sandbox.built_on) >= 8 and starts >= sandbox.history_from then
    perform set_config('agla.demo_today', starts::text, true);
    this_exam := private.demo_id(target_sandbox::text || ':exam:class-test');
    exam_days := array(select d from private.demo_school_days(starts, sandbox.built_on) as d order by d limit 2);
    insert into public.exams (id, academic_year_id, kind, title, school_id, starts_on, ends_on, created_by, created_at, updated_at)
    select this_exam, year_id, 'class_test',
      'कक्षा परीक्षा – ' || month_names[extract(month from sandbox.built_on)::integer],
      p.school_id, starts, sandbox.built_on, visitor_teacher, private.demo_at(starts - 1, 900), private.demo_at(starts - 1, 900)
    from private.demo_places as p
    where p.sandbox_id = target_sandbox and p.school_index = 1 and p.grade = 2;

    insert into public.exam_papers (id, exam_id, class_section_id, school_id, subject, held_on, scale, max_marks, created_at, updated_at)
    select private.demo_id(this_exam::text || p.class_section_id::text || subject.name), this_exam,
      p.class_section_id, p.school_id, subject.name,
      coalesce(exam_days[subject.position], starts), 'marks', 25,
      private.demo_at(starts - 1, 905), private.demo_at(starts - 1, 905)
    from private.demo_places as p
    cross join lateral (
      select name, position::integer from unnest(array['hindi', 'maths']) with ordinality as subject (name, position)
    ) as subject
    where p.sandbox_id = target_sandbox and p.school_index = 1 and p.grade > 1;

    insert into public.exam_marks (paper_id, student_id, marks, absent, entered_by, entered_at, updated_by, updated_at)
    select paper.id, e.student_id,
      case when not private.demo_absent(e.student_id, paper.class_section_id, paper.held_on) then
        round(2 * 25 * greatest(0.08, least(1.0, 0.22 + 0.66 * private.demo_rand(e.student_id::text || ':reading')
          + (private.demo_rand(e.student_id::text || paper.id::text) - 0.5) * 0.2))) / 2
      end,
      private.demo_absent(e.student_id, paper.class_section_id, paper.held_on),
      visitor_teacher, least(now(), private.demo_at(paper.held_on + 1, 850)),
      visitor_teacher, least(now(), private.demo_at(paper.held_on + 1, 850))
    from public.exam_papers as paper
    join public.enrolments as e
      on e.class_section_id = paper.class_section_id
     and e.enrolled_on <= paper.held_on
     and (e.ended_on is null or e.ended_on >= paper.held_on)
    join public.students as st on st.id = e.student_id and st.status <> 'pending'
    where paper.exam_id = this_exam and paper.subject = 'hindi' and paper.held_on < sandbox.built_on;
  end if;

  return jsonb_build_object('marks', marks_written);
end;
$$;
