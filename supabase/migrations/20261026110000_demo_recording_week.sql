-- Demonstration districts: the sample recordings wait in the class the CRP visits next on every
-- day of the month.
--
-- From the 29th, the days after a month's four weeks, every child drawn for the planned class could
-- already be past the week's end, so a recording went to a class nobody was about to visit. A
-- child whose week has passed now qualifies too, after the children of the current week.

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
          v.id is not null and s.due_on >= sandbox.built_on and k.mode = 'recorded'
          and not exists (select 1 from public.pulse_checks as again where again.sample_id = s.id and again.attempt = 2)
          and not exists (select 1 from public.pulse_reviews as r where r.check_id = k.id)
          and not exists (select 1 from public.visit_rechecks as r where r.check_id = k.id)
        )
      )
    -- The class the CRP visits next first; in it a child of this week first (their check is the
    -- newest the CRP will see), then one whose week has passed, as in the catch-up days after the
    -- 28th, when every child of the week may be late.
    order by (v.id is null), (s.due_on < sandbox.built_on), (k.id is not null),
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
