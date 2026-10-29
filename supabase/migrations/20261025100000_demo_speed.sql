-- Demonstration districts, built faster.
--
-- Every step of building a district runs as one request of the `demo` function, and the Data API
-- ends a statement after eight seconds. Measured on the hosted project, writing the months of
-- attendance took seven seconds (a statement for each school day) and the Pulse nearly six (the
-- draws of every class and month, then the checks). Attendance is now written in a single
-- statement, and the Pulse in two steps: `draws`, then `pulse` for the checks, their scores and
-- the CRPs' listening.
--
-- Most of the time went into the small functions that make the district's chances (one call for
-- every child on every school day). A function with its own `search_path` setting cannot be
-- inlined into the query that calls it, so each was a separate call. These are pure arithmetic on
-- their arguments that read and write nothing, with every name qualified, so they need no setting
-- of their own; without it Postgres inlines them.

-- A number in [0, 1) that depends only on `key`: the same district always tells the same story.
create or replace function private.demo_rand(key text)
returns double precision
language sql
immutable
parallel safe
as $$
  select ('x' || substr(pg_catalog.md5(key), 1, 8))::bit(32)::bigint / 4294967296.0
$$;

create or replace function private.demo_pick(choices text[], key text)
returns text
language sql
immutable
parallel safe
as $$
  select choices[1 + floor(private.demo_rand(key) * pg_catalog.cardinality(choices))::integer]
$$;

-- An identifier that depends only on `key`.
create or replace function private.demo_id(key text)
returns uuid
language sql
immutable
parallel safe
as $$
  select pg_catalog.md5(key)::uuid
$$;

-- School days: Monday to Saturday, outside the summer vacation (June) and the national holidays.
create or replace function private.demo_school_days(first_day date, last_day date)
returns setof date
language sql
immutable
parallel safe
as $$
  select day::date
  from pg_catalog.generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') as day
  where extract(isodow from day) < 7
    and extract(month from day) <> 6
    and pg_catalog.to_char(day, 'MM-DD') not in ('01-26', '08-15', '10-02', '12-25')
$$;

-- Whether a child was absent on a day: each child has their own habit, the monsoon keeps a few
-- more at home, and now and then a whole class thins out (a wedding, a fair, heavy rain).
create or replace function private.demo_absent(student uuid, class_section uuid, day date)
returns boolean
language sql
immutable
parallel safe
as $$
  select private.demo_rand(student::text || day::text)
    < 0.06
      + 0.16 * power(private.demo_rand(student::text || ':absence'), 3)
      + case when extract(month from day) in (7, 8) then 0.03 else 0 end
      + case when private.demo_rand(class_section::text || day::text) < 0.05 then 0.18 else 0 end
$$;

-- A local time of a day in India, `minutes` after midnight.
create or replace function private.demo_at(day date, minutes double precision)
returns timestamptz
language sql
immutable
parallel safe
as $$
  select (day::timestamp + make_interval(secs => minutes * 60)) at time zone 'Asia/Kolkata'
$$;

-- The level next to `level`, one step up or down.
create or replace function private.demo_level_step(level text, up boolean)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when up then case level when 'needs_support' then 'hesitant' else 'fluent' end
    else case level when 'fluent' then 'hesitant' else 'needs_support' end
  end
$$;

-- Attendance of the first cluster's classes on every school day until yesterday, marked each
-- morning by the class teacher. Today's register is left for the visitor.
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
    cross join private.demo_school_days(sandbox.history_from, sandbox.built_on - 1) as d (day)
    join public.class_teachers as t on t.class_section_id = p.class_section_id and t.is_primary
    join public.enrolments as e
      on e.class_section_id = p.class_section_id
     and e.enrolled_on <= d.day
     and (e.ended_on is null or e.ended_on >= d.day)
    where p.sandbox_id = target_sandbox
      and p.cluster_index = 1
      -- Now and then a register is not filled in on the day.
      and private.demo_rand(p.class_section_id::text || d.day::text || ':missed') >= 0.02
    group by p.class_section_id, d.day, t.teacher_id
  ) as register;
  get diagnostics written = row_count;
  return jsonb_build_object('registers', written);
end;
$$;

-- The real draw of every class on the first of each month (the session's first day for a month
-- it began in), as the nightly schedule makes it.
create function private.demo_build_draws(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  month_start date;
  target record;
  drawn integer := 0;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  for month_start in
    select m::date
    from generate_series(
      date_trunc('month', sandbox.history_from)::date,
      date_trunc('month', sandbox.built_on)::date,
      interval '1 month'
    ) as m
    where extract(month from m) <> 6
  loop
    perform set_config('agla.demo_today', greatest(month_start, sandbox.history_from)::text, true);
    for target in
      select class_section_id from private.demo_places
      where sandbox_id = target_sandbox
      order by school_index, grade
    loop
      if private.draw_pulse_cycle(target.class_section_id, greatest(month_start, sandbox.history_from)) is not null then
        drawn := drawn + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('cycles', drawn);
end;
$$;

-- Each drawn child's check on a day of their week when they were in school, scored by the engine,
-- and listened to by the CRP where the engine was unsure or disagreed with the teacher.
create or replace function private.demo_build_pulse(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  first_month date;
  checks integer;
  passage_words constant integer[] := array[24, 41, 57];
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  first_month := date_trunc('month', sandbox.history_from)::date;

  perform set_config('agla.demo_today', sandbox.built_on::text, true);

  drop table if exists demo_checks;
  create temporary table demo_checks on commit drop as
  with drawn as (
    select
      s.id as sample_id, s.class_section_id, s.student_id, s.adapted, s.opens_on, s.due_on,
      c.month, p.school_id, p.school_index, p.cluster_index, p.grade, p.medium,
      ((extract(year from c.month) - extract(year from first_month)) * 12
        + extract(month from c.month) - extract(month from first_month))::integer as month_index
    from public.pulse_samples as s
    join public.pulse_cycles as c on c.id = s.cycle_id
    join private.demo_places as p on p.class_section_id = s.class_section_id
    where p.sandbox_id = target_sandbox and s.week is not null and s.opens_on <= sandbox.built_on
  ),
  dated as (
    select d.*, chosen.day
    from drawn as d
    cross join lateral (
      select x as day
      from private.demo_school_days(d.opens_on, least(d.due_on, sandbox.built_on)) as x
      where not private.demo_absent(d.student_id, d.class_section_id, x)
      -- Teachers record early in the week.
      order by x + floor(private.demo_rand(d.sample_id::text || x::text) * 4)::integer, x
      limit 1
    ) as chosen
    where case
      when d.due_on < sandbox.built_on then private.demo_rand(d.sample_id::text || ':missed') >= 0.025
      -- This week's children: some are done; the visitor's own classes keep most for the visitor.
      when d.school_index = 1 and d.grade > 1 then private.demo_rand(d.sample_id::text || ':now') < 0.3
      else private.demo_rand(d.sample_id::text || ':now') < 0.6
    end
  ),
  levelled as (
    select d.*, truth.reading, truth.reached, truth.wcpm, truth.english,
      private.demo_rand(d.sample_id::text || ':teacher') as teacher_roll,
      private.demo_rand(d.sample_id::text || ':engine') as engine_roll,
      private.demo_rand(d.sample_id::text || ':unsure') < 0.04 as unsure,
      least(
        private.demo_at(d.day, 580 + 200 * private.demo_rand(d.sample_id::text || ':time')),
        now() - interval '20 minutes'
      ) as recorded_at
    from dated as d
    cross join lateral private.demo_child(d.student_id, d.school_id, d.grade, d.month_index, d.cluster_index = 1) as truth
  )
  select
    l.*,
    private.demo_id(l.sample_id::text || ':check') as check_id,
    case
      when l.teacher_roll < 0.09 and l.reading <> 'fluent' then private.demo_level_step(l.reading, true)
      when l.teacher_roll > 0.97 and l.reading <> 'needs_support' then private.demo_level_step(l.reading, false)
      else l.reading
    end as teacher_reading,
    case
      when l.engine_roll < 0.06 then
        private.demo_level_step(l.reading, l.reading = 'needs_support' or (l.reading = 'hesitant' and l.engine_roll < 0.03))
      else l.reading
    end as engine_reading,
    least(now() - interval '5 minutes', l.recorded_at + make_interval(mins => 2 + floor(80 * private.demo_rand(l.sample_id::text || ':sent'))::integer)) as received_at,
    lpad((1 + (floor(private.demo_rand(l.student_id::text || ':passage') * 12)::integer + l.month_index) % 12)::text, 2, '0') as passage_number,
    lpad((1 + (floor(private.demo_rand(l.student_id::text || ':prompt') * 12)::integer + l.month_index) % 12)::text, 2, '0') as prompt_number,
    25000 + floor(35000 * private.demo_rand(l.sample_id::text || ':length'))::integer as duration_ms,
    -48 + 24 * private.demo_rand(l.sample_id::text || ':noise') as noise_dbfs
  from levelled as l;

  -- Recent recordings the engine and the teacher disagree on are heard by the CRP within days;
  -- one sent in the last three days that would still wait is one they agree on.
  update demo_checks
  set engine_reading = teacher_reading, unsure = false
  where received_at > now() - interval '3 days'
    and (engine_reading <> teacher_reading or unsure);

  insert into public.pulse_checks (
    id, sample_id, class_section_id, student_id, mode, attempt, item_code, prompt_code, item,
    audio_path, audio_type, audio_bytes, duration_ms, noise_dbfs, reading_level, english_level,
    clarity, classroom, tags, recorded_at, recorded_by, received_at, audio_deleted_at
  )
  select
    k.check_id, k.sample_id, k.class_section_id, k.student_id,
    case when k.adapted then 'adapted' else 'recorded' end,
    1,
    case when not k.adapted then k.medium || '-g' || k.grade || '-p' || k.passage_number end,
    case when not k.adapted then 'en-g' || k.grade || '-s' || k.prompt_number end,
    case when k.adapted then '{}'::jsonb else jsonb_build_object(
      'reading', jsonb_build_object('code', k.medium || '-g' || k.grade || '-p' || k.passage_number,
                                    'language', k.medium, 'grade', k.grade),
      'speaking', jsonb_build_object('code', 'en-g' || k.grade || '-s' || k.prompt_number, 'grade', k.grade),
      'shown', case k.reached
        when 'passage' then jsonb_build_array(
          jsonb_build_object('level', 'passage', 'atMs', 0),
          jsonb_build_object('level', 'english', 'atMs', least(40000, k.duration_ms - 14000)))
        when 'words' then jsonb_build_array(
          jsonb_build_object('level', 'passage', 'atMs', 0),
          jsonb_build_object('level', 'words', 'atMs', 12000),
          jsonb_build_object('level', 'english', 'atMs', least(40000, k.duration_ms - 14000)))
        else jsonb_build_array(
          jsonb_build_object('level', 'passage', 'atMs', 0),
          jsonb_build_object('level', 'words', 'atMs', 10000),
          jsonb_build_object('level', 'letters', 'atMs', 21000),
          jsonb_build_object('level', 'english', 'atMs', least(40000, k.duration_ms - 14000)))
      end,
      'restarts', 0)
    end,
    case when not k.adapted then k.class_section_id || '/' || k.sample_id || '/' || k.check_id || '.webm' end,
    case when not k.adapted then 'audio/webm' end,
    case when not k.adapted then k.duration_ms * 4 end,
    case when not k.adapted then k.duration_ms end,
    case when not k.adapted then k.noise_dbfs end,
    k.teacher_reading,
    k.english,
    case when k.adapted then null
      when private.demo_rand(k.sample_id::text || ':clarity') < 0.08 then 'low_voice'
      when private.demo_rand(k.sample_id::text || ':clarity') < 0.13 then 'nervous'
      else 'clear'
    end,
    case when k.adapted then null when k.noise_dbfs > -30 then 'noisy' else 'normal' end,
    case
      when private.demo_rand(k.sample_id::text || ':tags') < 0.55 then
        case k.teacher_reading
          when 'fluent' then array['good_pace']
          when 'hesitant' then array['missed_words']
          else array['needed_prompting']
        end
      else '{}'::text[]
    end,
    k.recorded_at,
    private.demo_class_teacher(k.class_section_id),
    k.received_at,
    case when not k.adapted and k.received_at < now() - interval '30 days'
      then k.received_at + interval '30 days 3 hours'
    end
  from demo_checks as k;
  get diagnostics checks = row_count;

  insert into public.pulse_scores (
    check_id, class_section_id, engine_version, reading_level, reached_level, reading_items,
    reading_correct, reading_seconds, wcpm, english_level, english_words, english_seconds,
    keyword_hits, other_language_share, confidence, flags
  )
  select
    k.check_id, k.class_section_id,
    'pulse-engine 1.0 (indicconformer-600m-ctc; whisper-small)',
    k.engine_reading,
    shown.reached,
    case shown.reached when 'passage' then passage_words[k.grade] else 10 end,
    case shown.reached
      when 'passage' then least(passage_words[k.grade], round(shown.wcpm * shown.seconds / 60.0)::integer)
      when 'words' then 3 + floor(5 * private.demo_rand(k.sample_id::text || ':correct'))::integer
      else 2 + floor(4 * private.demo_rand(k.sample_id::text || ':correct'))::integer
    end,
    shown.seconds,
    shown.wcpm,
    k.english,
    case k.english
      when 'sentences' then 8 + floor(12 * private.demo_rand(k.sample_id::text || ':said'))::integer
      when 'words' then 2 + floor(5 * private.demo_rand(k.sample_id::text || ':said'))::integer
      else 0
    end,
    12 + 14 * private.demo_rand(k.sample_id::text || ':speaking'),
    case k.english
      when 'sentences' then 2 + floor(3 * private.demo_rand(k.sample_id::text || ':keywords'))::integer
      when 'words' then 1 + floor(2 * private.demo_rand(k.sample_id::text || ':keywords'))::integer
      else 0
    end,
    round((0.2 * private.demo_rand(k.sample_id::text || ':mixed'))::numeric, 2),
    case when k.unsure
      then round((0.38 + 0.16 * private.demo_rand(k.sample_id::text || ':confidence'))::numeric, 2)
      else round((0.66 + 0.3 * private.demo_rand(k.sample_id::text || ':confidence'))::numeric, 2)
    end,
    array_remove(array[
      case when k.unsure then 'low_confidence' end,
      case when k.english = 'no_response' then 'no_english' end
    ], null)
  from demo_checks as k
  cross join lateral (
    select
      case
        when k.engine_reading = 'needs_support' then case when k.reached = 'letters' then 'letters' else 'words' end
        when k.reached = 'passage' then 'passage'
        when k.engine_reading = 'fluent' then 'passage'
        else 'words'
      end as reached
  ) as step
  cross join lateral (
    select step.reached,
      case
        when step.reached <> 'passage' then null
        when k.engine_reading = 'fluent' then greatest(coalesce(k.wcpm, 0), (array[28, 45, 60])[k.grade])
        when k.engine_reading = 'hesitant' then least(coalesce(k.wcpm, (array[14, 22, 30])[k.grade]), (array[28, 45, 60])[k.grade] - 3)
        else null
      end as wcpm,
      case when step.reached = 'passage' then 40 else 28 end
        + round((12 * private.demo_rand(k.sample_id::text || ':reading-time'))::numeric, 1) as seconds
  ) as shown
  where not k.adapted;

  -- The CRP of the cluster listened where the engine was unsure or the two disagreed.
  insert into public.pulse_reviews (check_id, class_section_id, reviewed_by, reading_level, english_level, reviewed_at)
  select
    k.check_id, k.class_section_id, private.demo_crp(target_sandbox, k.cluster_index), k.reading, k.english,
    least(now() - interval '1 hour', k.received_at + make_interval(hours => 20 + floor(70 * private.demo_rand(k.sample_id::text || ':heard'))::integer))
  from demo_checks as k
  where not k.adapted and (k.unsure or k.engine_reading <> k.teacher_reading)
    -- A few older ones went unheard before their file was removed; recent ones are all heard.
    and (k.received_at > now() - interval '30 days' or private.demo_rand(k.sample_id::text || ':missed-listen') < 0.75);

  return jsonb_build_object('checks', checks);
end;
$$;

-- Builds one step of a demonstration district.
create or replace function private.demo_build(target_sandbox uuid, phase text, details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from private.demo_sandboxes where id = target_sandbox and status = 'building'
  ) then
    raise exception 'There is no such demonstration district being built.' using errcode = '22023';
  end if;
  perform set_config('agla.demo_work', 'on', true);
  result := case phase
    when 'places' then private.demo_build_places(target_sandbox)
    when 'people' then private.demo_build_people(target_sandbox, details)
    when 'attendance' then private.demo_build_attendance(target_sandbox)
    when 'draws' then private.demo_build_draws(target_sandbox)
    when 'pulse' then private.demo_build_pulse(target_sandbox)
    when 'coaching' then private.demo_build_coaching(target_sandbox)
    when 'exams' then private.demo_build_exams(target_sandbox)
    when 'notes' then private.demo_build_notes(target_sandbox)
    when 'finish' then private.demo_build_finish(target_sandbox, details)
  end;
  if result is null then
    raise exception 'There is no step "%".', phase using errcode = '22023';
  end if;
  perform set_config('agla.demo_today', '', true);
  perform set_config('agla.demo_work', '', true);
  return result;
end;
$$;

revoke all on function private.demo_build_draws(uuid) from public;
