-- Pulse scoring: what the speech engine measured in each recorded check, kept next to the
-- teacher's own impression so that the two can be compared.
--
-- The engine (`engine/` in the repository) runs every night on a CPU, and on a GPU when more is
-- needed. With the secret key it reads the checks still to score, downloads each recording,
-- transcribes the reading and the English parts, and writes one row per check:
--   * reading: the step the child read at (passage, words or letters), how many of its items were
--     read correctly, words correct per minute for a passage, and a level on the teacher's scale;
--   * speaking: how many English words the child said, how many of the prompt's keywords, how much
--     of it was in another language, and a level on the teacher's scale;
--   * quality: how confident the engine is, and flags such as a recording without speech.
-- The transcript is kept only as long as the recording (30 days); the measures stay. The engine
-- never sees the teacher's levels while scoring; agreement is measured afterwards, on both scales.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.pulse_scores (
  check_id uuid primary key references public.pulse_checks (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  engine_version text not null,
  scored_at timestamptz not null default now(),
  reading_level text not null,
  reached_level text not null,
  reading_items smallint not null,
  reading_correct smallint not null,
  reading_seconds real not null,
  wcpm real,
  english_level text not null,
  english_words smallint not null,
  english_seconds real not null,
  keyword_hits smallint not null,
  other_language_share real not null,
  confidence real not null,
  flags text[] not null default '{}',
  transcript jsonb,
  transcript_deleted_at timestamptz,
  constraint pulse_scores_engine_version_length check (char_length(engine_version) between 1 and 120),
  constraint pulse_scores_reading_level_valid check (
    reading_level in ('fluent', 'hesitant', 'needs_support')
  ),
  constraint pulse_scores_reached_level_valid check (
    reached_level in ('passage', 'words', 'letters')
  ),
  constraint pulse_scores_reading_counts check (
    reading_items between 0 and 200 and reading_correct between 0 and reading_items
  ),
  constraint pulse_scores_reading_seconds_range check (reading_seconds between 0 and 61),
  constraint pulse_scores_wcpm_range check (
    wcpm is null or (reached_level = 'passage' and wcpm between 0 and 400)
  ),
  constraint pulse_scores_english_level_valid check (
    english_level in ('sentences', 'words', 'no_response')
  ),
  constraint pulse_scores_english_counts check (
    english_words between 0 and 400 and keyword_hits between 0 and 50
  ),
  constraint pulse_scores_english_seconds_range check (english_seconds between 0 and 61),
  constraint pulse_scores_shares_range check (
    other_language_share between 0 and 1 and confidence between 0 and 1
  ),
  constraint pulse_scores_flags_valid check (
    flags <@ array[
      'no_speech', 'no_reading', 'no_english', 'quiet', 'low_confidence', 'other_language',
      'unknown_item', 'seen_before', 'fallback_recogniser'
    ]
    and cardinality(flags) <= 9
  ),
  constraint pulse_scores_transcript_shape check (
    transcript is null
    or (jsonb_typeof(transcript) = 'object' and octet_length(transcript::text) <= 16384)
  ),
  constraint pulse_scores_transcript_removed check (
    transcript_deleted_at is null or transcript is null
  )
);

comment on table public.pulse_scores is
  'What the speech engine measured in a recorded Pulse check. One row per check; a newer engine '
  'replaces it.';
comment on column public.pulse_scores.reached_level is
  'The easiest step the child read at: the passage, the words, or the letters.';
comment on column public.pulse_scores.reading_items is
  'Items of the reached step: words of the passage, step-down words, or letters.';
comment on column public.pulse_scores.wcpm is
  'Words of the passage read correctly per minute; only when the child read the passage.';
comment on column public.pulse_scores.other_language_share is
  'Share of the English part spoken in another language, from 0 to 1.';
comment on column public.pulse_scores.transcript is
  'What the engine heard, for listening alongside the recording. Removed with the recording.';

create index pulse_scores_class_section_id_idx on public.pulse_scores (class_section_id);
create index pulse_scores_scored_at_idx on public.pulse_scores (scored_at);

-- Checks the engine could not score (for example a damaged file). After three attempts with the
-- same engine a check is left alone, so that one bad file never holds up a night's run.
create table public.pulse_score_failures (
  check_id uuid primary key references public.pulse_checks (id) on delete cascade,
  engine_version text not null,
  attempts smallint not null default 1,
  reason text not null,
  last_tried_at timestamptz not null default now(),
  constraint pulse_score_failures_attempts_range check (attempts between 1 and 1000),
  constraint pulse_score_failures_reason_length check (char_length(reason) between 1 and 500),
  constraint pulse_score_failures_engine_length check (char_length(engine_version) between 1 and 120)
);

comment on table public.pulse_score_failures is
  'Recorded checks the engine could not score, with the number of attempts by the same engine.';

-- One row per run of the engine, for following the nightly scoring from the console.
create table public.pulse_scoring_runs (
  id uuid primary key default gen_random_uuid(),
  runner text not null,
  engine_version text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  scored integer not null,
  failed integer not null,
  compared integer not null default 0,
  reading_kappa real,
  english_kappa real,
  constraint pulse_scoring_runs_runner_valid check (runner in ('scheduled', 'gpu', 'local')),
  constraint pulse_scoring_runs_engine_length check (char_length(engine_version) between 1 and 120),
  constraint pulse_scoring_runs_counts check (scored >= 0 and failed >= 0 and compared >= 0),
  constraint pulse_scoring_runs_kappa_range check (
    (reading_kappa is null or reading_kappa between -1 and 1)
    and (english_kappa is null or english_kappa between -1 and 1)
  ),
  constraint pulse_scoring_runs_times check (finished_at >= started_at)
);

comment on table public.pulse_scoring_runs is
  'Runs of the scoring engine: how many checks were scored, and how far the engine agreed with '
  'the teachers (Cohen''s kappa over the last 90 days) at the end of the run.';

create index pulse_scoring_runs_finished_at_idx on public.pulse_scoring_runs (finished_at);

-- ---------------------------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------------------------

-- A score belongs to a recorded check, and its class is the check's. A check that is scored at
-- last is no longer listed as a failure. Removing the transcript with the recording changes
-- nothing else, and a score that arrives after the recording was removed keeps no transcript.
create function private.guard_pulse_score_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  check_row record;
begin
  if tg_op = 'UPDATE' and new.transcript is null and new.transcript_deleted_at is not null then
    new.class_section_id := old.class_section_id;
    new.scored_at := old.scored_at;
    return new;
  end if;

  select k.class_section_id, k.mode, k.audio_deleted_at into check_row
  from public.pulse_checks as k
  where k.id = new.check_id;
  if not found then
    raise exception 'There is no such check.' using errcode = '23503';
  end if;
  if check_row.mode <> 'recorded' then
    raise exception 'Only recorded checks are scored.' using errcode = '23514';
  end if;
  new.class_section_id := check_row.class_section_id;
  new.scored_at := now();
  if check_row.audio_deleted_at is not null then
    new.transcript := null;
    new.transcript_deleted_at := now();
  else
    new.transcript_deleted_at := null;
  end if;
  delete from public.pulse_score_failures where check_id = new.check_id;
  return new;
end;
$$;

create trigger pulse_scores_guard_write before insert or update on public.pulse_scores
  for each row execute function private.guard_pulse_score_write();

revoke all on function private.guard_pulse_score_write() from public;

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

alter table public.pulse_scores enable row level security;
alter table public.pulse_score_failures enable row level security;
alter table public.pulse_scoring_runs enable row level security;

revoke all on table public.pulse_scores from anon, authenticated, service_role;
revoke all on table public.pulse_score_failures from anon, authenticated, service_role;
revoke all on table public.pulse_scoring_runs from anon, authenticated, service_role;

-- Only the engine, with the secret key, writes.
grant select on table public.pulse_scores to authenticated;
grant select, insert, update on table public.pulse_scores to service_role;
grant select, insert, update, delete on table public.pulse_score_failures to service_role;
grant select on table public.pulse_scoring_runs to authenticated;
grant select, insert on table public.pulse_scoring_runs to service_role;

-- Scores are read where the checks are: by the school's staff and its CRP.
create policy "Staff can read Pulse scores of their schools" on public.pulse_scores
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.class_section_school_id(class_section_id)
       = any ((select private.staff_school_ids())::uuid[])
  );

create policy "Administrators can follow the scoring runs" on public.pulse_scoring_runs
  for select to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------------------------
-- Service functions for the engine
-- ---------------------------------------------------------------------------------------------

-- Like the other service functions, these run with the caller's rights: only the secret key's
-- role may call them.

-- Recorded checks to score, oldest first: those without a score, then those scored by another
-- engine version; checks this engine already tried come after the others, and one it tried three
-- times is skipped. The teacher's levels are not returned, so that the engine scores without
-- knowing them.
create function public.service_pulse_checks_to_score(batch_size integer, current_engine text)
returns table (
  check_id uuid,
  audio_path text,
  audio_type text,
  item jsonb,
  grade smallint,
  reading_language text,
  duration_ms integer,
  item_seen_before boolean
)
language sql
stable
set search_path = ''
as $$
  select k.id, k.audio_path, k.audio_type, k.item, c.grade, c.language, k.duration_ms,
    k.item_seen_before
  from public.pulse_checks as k
  join public.pulse_samples as s on s.id = k.sample_id
  join public.pulse_cycles as c on c.id = s.cycle_id
  left join public.pulse_scores as p on p.check_id = k.id
  left join public.pulse_score_failures as f
    on f.check_id = k.id and f.engine_version = current_engine
  where k.mode = 'recorded'
    and k.audio_path is not null
    and k.audio_deleted_at is null
    and (p.check_id is null or p.engine_version <> current_engine)
    and coalesce(f.attempts, 0) < 3
  order by (p.check_id is not null), coalesce(f.attempts, 0), k.received_at
  limit greatest(1, least(coalesce(batch_size, 50), 500))
$$;

-- Notes an attempt to score a check, before the engine starts on it (so that a run that ends in
-- the middle still counts it), and the reason when it could not be scored (`counts_attempt` false:
-- the same attempt, with its reason). Returns the number of attempts so far.
create function public.service_record_pulse_score_failure(
  target_check_id uuid,
  current_engine text,
  failure_reason text,
  counts_attempt boolean default true
)
returns integer
language sql
set search_path = ''
as $$
  insert into public.pulse_score_failures (check_id, engine_version, reason)
  values (target_check_id, current_engine, left(coalesce(nullif(failure_reason, ''), 'unknown'), 500))
  on conflict (check_id) do update
  set attempts = case
        when public.pulse_score_failures.engine_version <> excluded.engine_version then 1
        when counts_attempt then least(public.pulse_score_failures.attempts + 1, 1000)
        else public.pulse_score_failures.attempts
      end,
      engine_version = excluded.engine_version,
      reason = excluded.reason,
      last_tried_at = now()
  returning attempts
$$;

-- How often each pair of the teacher's and the engine's levels occurred among the checks recorded
-- since `since` and scored by `current_engine`, for measuring how far they agree. At most 81 rows,
-- whatever the number of checks.
create function public.service_pulse_agreement(since timestamptz, current_engine text)
returns table (
  teacher_reading text,
  machine_reading text,
  teacher_english text,
  machine_english text,
  checks integer
)
language sql
stable
set search_path = ''
as $$
  select k.reading_level, p.reading_level, k.english_level, p.english_level, count(*)::integer
  from public.pulse_scores as p
  join public.pulse_checks as k on k.id = p.check_id
  where k.recorded_at >= since and p.engine_version = current_engine
  group by 1, 2, 3, 4
$$;

-- The retention job's note that recordings were deleted now also removes their transcripts.
create or replace function public.service_mark_pulse_audio_removed(paths text[])
returns integer
language sql
set search_path = ''
as $$
  with removed as (
    update public.pulse_checks
    set audio_deleted_at = now()
    where audio_path = any (paths) and audio_deleted_at is null
    returning id
  ),
  forgotten as (
    update public.pulse_scores
    set transcript = null, transcript_deleted_at = now()
    where check_id in (select id from removed) and transcript is not null
    returning 1
  )
  select count(*)::integer from removed
$$;

revoke all on function public.service_pulse_checks_to_score(integer, text) from public, anon, authenticated;
revoke all on function public.service_record_pulse_score_failure(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.service_pulse_agreement(timestamptz, text) from public, anon, authenticated;

grant execute on function
  public.service_pulse_checks_to_score(integer, text),
  public.service_record_pulse_score_failure(uuid, text, text, boolean),
  public.service_pulse_agreement(timestamptz, text)
  to service_role;
