-- Demonstration districts built on the 29th, 30th or 31st.
--
-- This week's children are told apart by a due day that has not passed. From the 29th every week
-- of the month is over, so no child was left to record and the visitor teacher had nothing to
-- do in Pulse. Until the month ends, the fourth week's children are this week's.

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
      s.id as sample_id, s.class_section_id, s.student_id, s.adapted, s.opens_on, s.due_on, s.week,
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
      -- From the 29th the month's four weeks are over and what is left is catch-up: the last
      -- week's children still count as this week's, so that some are always left to record.
      when d.due_on < sandbox.built_on and not (d.week = 4 and extract(day from sandbox.built_on) > 28)
        then private.demo_rand(d.sample_id::text || ':missed') >= 0.025
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

-- The recording step counts the fourth week's children as this week's in the same way.
create or replace function private.demo_build_finish(target_sandbox uuid, details jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  recording jsonb;
  target record;
  check_id uuid;
  audio_type text;
  audio_path text;
  uploads jsonb := '[]'::jsonb;
  taken uuid[] := '{}';
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  perform set_config('agla.demo_today', sandbox.built_on::text, true);

  for recording in select value from jsonb_array_elements(coalesce(details -> 'recordings', '[]'::jsonb)) loop
    select s.id as sample_id, s.class_section_id, s.student_id, s.opens_on, k.id as earlier_check
    into target
    from public.pulse_samples as s
    join public.pulse_cycles as c on c.id = s.cycle_id
    join private.demo_places as p on p.class_section_id = s.class_section_id
    left join public.visits as v
      on v.class_section_id = s.class_section_id and v.status = 'planned'
    left join public.pulse_checks as k on k.sample_id = s.id and k.attempt = 1
    where p.sandbox_id = target_sandbox
      and p.cluster_index = 1 and p.medium = 'hi'
      and p.grade = (recording ->> 'grade')::integer
      and c.month = date_trunc('month', sandbox.built_on)::date
      and s.week is not null and s.opens_on <= sandbox.built_on and not s.adapted
      and not (s.id = any (taken))
      -- Late in the week every child of the class the CRP visits next may be checked already;
      -- the recording then takes the place of a recorded check of this week nobody has looked at.
      and (
        k.id is null
        or (
          v.id is not null and (s.due_on >= sandbox.built_on or (s.week = 4 and extract(day from sandbox.built_on) > 28)) and k.mode = 'recorded'
          and not exists (select 1 from public.pulse_checks as again where again.sample_id = s.id and again.attempt = 2)
          and not exists (select 1 from public.pulse_reviews as r where r.check_id = k.id)
          and not exists (select 1 from public.visit_rechecks as r where r.check_id = k.id)
        )
      )
    -- The class the CRP visits next first; in it a child of this week first (their check is the
    -- newest the CRP will see), then one whose week has passed, as in the catch-up days after the
    -- 28th, when every child of the week may be late.
    order by (v.id is null), (not (s.due_on >= sandbox.built_on or (s.week = 4 and extract(day from sandbox.built_on) > 28))), (k.id is not null),
      private.demo_rand(s.id::text || (recording ->> 'key'))
    limit 1;
    continue when not found;
    taken := taken || target.sample_id;
    if target.earlier_check is not null then
      delete from public.pulse_checks where id = target.earlier_check;
    end if;
    check_id := private.demo_id(target.sample_id::text || ':recording');
    audio_type := case recording ->> 'type' when 'audio/ogg' then 'audio/ogg' when 'audio/mp4' then 'audio/mp4' else 'audio/webm' end;
    audio_path := target.class_section_id || '/' || target.sample_id || '/' || check_id
      || case audio_type when 'audio/ogg' then '.ogg' when 'audio/mp4' then '.m4a' else '.webm' end;

    insert into public.pulse_checks (
      id, sample_id, class_section_id, student_id, mode, attempt, item_code, prompt_code, item,
      audio_path, audio_type, audio_bytes, duration_ms, noise_dbfs, reading_level, english_level,
      clarity, classroom, tags, recorded_at, recorded_by, received_at
    )
    values (
      check_id, target.sample_id, target.class_section_id, target.student_id, 'recorded', 1,
      recording ->> 'item_code', recording ->> 'prompt_code',
      jsonb_build_object(
        'reading', jsonb_build_object('code', recording ->> 'item_code', 'language', 'hi', 'grade', (recording ->> 'grade')::integer),
        'speaking', jsonb_build_object('code', recording ->> 'prompt_code', 'grade', (recording ->> 'grade')::integer),
        'shown', coalesce(recording -> 'shown', '[]'::jsonb),
        'restarts', 0
      ),
      audio_path, audio_type, (recording ->> 'bytes')::integer, (recording ->> 'duration_ms')::integer,
      -38, recording ->> 'teacher_reading', recording ->> 'teacher_english', 'clear', 'normal', '{}',
      least(now() - interval '2 hours', private.demo_at(greatest(target.opens_on, sandbox.built_on - 1), 620)),
      private.demo_class_teacher(target.class_section_id),
      least(now() - interval '1 hour', private.demo_at(greatest(target.opens_on, sandbox.built_on - 1), 650))
    );

    insert into public.pulse_scores (
      check_id, class_section_id, engine_version, reading_level, reached_level, reading_items,
      reading_correct, reading_seconds, wcpm, english_level, english_words, english_seconds,
      keyword_hits, other_language_share, confidence, flags
    )
    select check_id, target.class_section_id, score.engine_version, score.reading_level,
      score.reached_level, score.reading_items, score.reading_correct, score.reading_seconds,
      score.wcpm, score.english_level, score.english_words, score.english_seconds,
      score.keyword_hits, score.other_language_share, score.confidence, score.flags
    from jsonb_to_record(recording -> 'score') as score (
      engine_version text, reading_level text, reached_level text, reading_items smallint,
      reading_correct smallint, reading_seconds real, wcpm real, english_level text,
      english_words smallint, english_seconds real, keyword_hits smallint,
      other_language_share real, confidence real, flags text[]
    );

    uploads := uploads || jsonb_build_object('key', recording ->> 'key', 'path', audio_path, 'type', audio_type);
  end loop;

  update private.demo_sandboxes set status = 'ready', ready_at = now() where id = target_sandbox;
  return jsonb_build_object('uploads', uploads);
end;
$$;
