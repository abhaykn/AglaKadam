-- Demonstration districts: today's registers, and homework due on school days.
--
-- The other classes of the visitor's cluster have their register for today once the morning is
-- under way, as they would; the visitor teacher's own classes are still left for the visitor.
-- Homework set before a Sunday or a holiday is due on the next school day.

create or replace function private.demo_build_attendance(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  written integer;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  perform set_config('agla.demo_today', (sandbox.built_on - 1)::text, true);
  insert into public.attendance_sessions (
    class_section_id, attendance_date, absent_student_ids, marked_by, created_at, updated_at
  )
  select
    register.class_section_id,
    register.day,
    register.absent,
    register.teacher_id,
    private.demo_at(register.day, 515 + 40 * private.demo_rand(register.class_section_id::text || register.day::text || ':marked')),
    private.demo_at(register.day, 515 + 40 * private.demo_rand(register.class_section_id::text || register.day::text || ':marked'))
  from (
    select
      p.class_section_id,
      d.day,
      t.teacher_id,
      coalesce(
        array_agg(e.student_id) filter (where private.demo_absent(e.student_id, p.class_section_id, d.day)),
        '{}'
      ) as absent
    from private.demo_places as p
    cross join private.demo_school_days(sandbox.history_from, sandbox.built_on) as d (day)
    join public.class_teachers as t on t.class_section_id = p.class_section_id and t.is_primary
    join public.enrolments as e
      on e.class_section_id = p.class_section_id
     and e.enrolled_on <= d.day
     and (e.ended_on is null or e.ended_on >= d.day)
    where p.sandbox_id = target_sandbox
      and p.cluster_index = 1
      -- Today's registers are marked by half past nine, except the visitor teacher's own.
      and (
        d.day < sandbox.built_on
        or (
          not (p.school_index = 1 and p.grade > 1)
          and (now() at time zone 'Asia/Kolkata')::time >= time '09:30'
        )
      )
      -- Now and then a register is not filled in on the day.
      and private.demo_rand(p.class_section_id::text || d.day::text || ':missed') >= 0.02
    group by p.class_section_id, d.day, t.teacher_id
  ) as register;
  get diagnostics written = row_count;
  return jsonb_build_object('registers', written);
end;
$$;

create or replace function private.demo_build_notes(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  written integer;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  insert into public.class_notes (id, class_section_id, school_id, kind, body, due_on, author_id, author_name, created_at)
  select
    private.demo_id(target_sandbox::text || ':note:' || p.class_section_id::text || ':' || note.position),
    p.class_section_id, p.school_id, note.kind, note.body,
    -- Homework is due on a school day, two days on at the earliest.
    case when note.kind = 'homework' then
      (select min(due) from private.demo_school_days(note.day + 2, note.day + 9) as due)
    end,
    teacher.id, teacher.full_name,
    least(now() - interval '1 hour', private.demo_at(note.day, 780 + 60 * private.demo_rand(p.class_section_id::text || note.position)))
  from private.demo_places as p
  join public.profiles as teacher on teacher.id = private.demo_class_teacher(p.class_section_id)
  cross join lateral (
    select entry.kind, entry.body, entry.position::integer,
      (select max(d) from private.demo_school_days(sandbox.built_on - entry.days_ago - 3, sandbox.built_on - entry.days_ago) as d) as day
    from (values
      (1, 'message', 'इस हफ़्ते बच्चों ने "प्यासा कौआ" कहानी पढ़ी। घर पर उनसे यह कहानी सुनिए और पूछिए कि कौए ने क्या किया।', 33),
      (2, 'homework', 'पाठ के पाँच नए शब्द कॉपी में दो-दो बार लिखो और घर पर ज़ोर से पढ़ो।', 27),
      (3, 'message', 'शनिवार को सुबह 11 बजे अभिभावक–शिक्षक बैठक है। बच्चे की प्रगति पर बात होगी, ज़रूर आइए।', 21),
      (4, 'homework', 'घर में दिखने वाली पाँच चीज़ों के नाम अंग्रेज़ी में बोलकर सुनाओ।', 15),
      (5, 'message', 'मासिक आकलन के अंक ऐप में "परिणाम" में देख सकते हैं। कोई प्रश्न हो तो विद्यालय आकर मिलिए।', 9),
      (6, 'homework', 'कहानी का एक चित्र बनाओ और उसके नीचे दो वाक्य लिखो।', 3)
    ) as entry (position, kind, body, days_ago)
  ) as note
  where p.sandbox_id = target_sandbox and p.school_index = 1 and note.day is not null
    and note.day >= sandbox.history_from
    and (p.grade > 1 or note.position in (1, 3, 5));
  get diagnostics written = row_count;
  return jsonb_build_object('notes', written);
end;
$$;
