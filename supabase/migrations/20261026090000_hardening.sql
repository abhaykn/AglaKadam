-- Hardening after a review of the whole application.
--
-- Demonstration districts:
--   * every identity made for a district is recorded the moment it exists, and removing a district
--     lists its identities to be deleted before its data goes, so none is ever left behind;
--   * a district whose removal keeps failing no longer holds up the others, and the sweep runs
--     every quarter of an hour;
--   * opening and building are serialised, and a district is never given an academic session made
--     up for it: without a real one covering today, no district opens;
--   * their geography, people and children are hidden from every real account, administrators
--     included, and what their visitors do leaves no trace in the audit trail;
--   * check-back days fall on school days, and the sample recordings always wait in the classes the
--     CRP visits next, also when the district is built late in the week.
-- Reports: a feedback score counts only for the feedback it scored, and a child who did not reach
-- the passage counts with no words a minute in the median speed.
-- Family sign-in: an unknown learner code is counted and locked exactly like a known one, so that
-- the answers never tell whether a code exists, and failures are forgotten after a day.
-- Consent: a decision kept on a phone before it could be sent is dated when it was taken, so that
-- the latest decision is the one in force whatever order phones send them in.
-- Pulse: a teacher learns every passage and prompt a child of their school was given before, in
-- any school.

-- ---------------------------------------------------------------------------------------------
-- Demonstration identities
-- ---------------------------------------------------------------------------------------------

create table private.demo_created_users (
  user_id uuid primary key,
  sandbox_id uuid not null references private.demo_sandboxes (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table private.demo_created_users is
  'Every identity the demo function made for a district, recorded as soon as it existed.';

create index demo_created_users_sandbox_id_idx on private.demo_created_users (sandbox_id);

create table private.demo_users_to_delete (
  user_id uuid primary key,
  listed_at timestamptz not null default now()
);

comment on table private.demo_users_to_delete is
  'Identities of removed demonstration districts, kept until the Auth service has deleted them.';

alter table private.demo_created_users enable row level security;
alter table private.demo_users_to_delete enable row level security;
revoke all on table private.demo_created_users from public, anon, authenticated;
revoke all on table private.demo_users_to_delete from public, anon, authenticated;

alter table private.demo_sandboxes add column removal_started_at timestamptz;

comment on column private.demo_sandboxes.removal_started_at is
  'When the sweep last began removing the district; one that keeps failing waits behind the others.';

-- Every account of a demonstration district: visitors', background staff, identities made for a
-- district that has not taken them in yet, and those of removed districts not yet deleted.
create or replace function private.demo_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct user_id), '{}')
  from (
    select user_id from private.demo_people
    union all
    select user_id from private.demo_accounts
    union all
    select user_id from private.demo_created_users
    union all
    select user_id from private.demo_users_to_delete
  ) as everyone
$$;

-- Every cluster of a demonstration district.
create function private.demo_cluster_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.cluster_id), '{}')
  from private.demo_places as p
  join public.schools as s on s.id = p.school_id
$$;

-- Whether the caller is an account of a demonstration district.
create function private.is_demo_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.uid() = any (private.demo_user_ids()), false)
$$;

-- Whether an account belongs to a demonstration district, at any stage of its life.
create function private.is_demo_account(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = any (private.demo_user_ids())
$$;

create function private.demo_note_account(target_sandbox uuid, target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.demo_created_users (user_id, sandbox_id)
  values (target_user_id, target_sandbox)
  on conflict (user_id) do nothing
$$;

create function private.demo_accounts_to_delete(batch_size integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(listed.user_id order by listed.listed_at), '[]'::jsonb)
  from (
    select user_id, listed_at from private.demo_users_to_delete
    order by listed_at
    limit greatest(1, least(coalesce(batch_size, 60), 200))
  ) as listed
$$;

create function private.demo_account_deleted(target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.demo_users_to_delete where user_id = target_user_id
$$;

create function private.demo_removing(target_sandbox uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.demo_sandboxes set removal_started_at = now() where id = target_sandbox
$$;

-- Districts due for removal, those not tried recently first, with the stored files to delete.
create or replace function private.demo_due(batch_size integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'sandbox', s.id,
      'files', jsonb_build_object(
        'pulse-audio', coalesce((
          select jsonb_agg(o.name)
          from storage.objects as o
          join private.demo_places as p on o.name like p.class_section_id::text || '/%'
          where o.bucket_id = 'pulse-audio' and p.sandbox_id = s.id
        ), '[]'::jsonb),
        'class-notes', coalesce((
          select jsonb_agg(o.name)
          from storage.objects as o
          join private.demo_places as p on o.name like p.class_section_id::text || '/%'
          where o.bucket_id = 'class-notes' and p.sandbox_id = s.id
        ), '[]'::jsonb),
        'visit-notes', coalesce((
          select jsonb_agg(n.audio_path)
          from public.visit_notes as n
          join public.visits as v on v.id = n.visit_id
          join private.demo_places as p on p.class_section_id = v.class_section_id
          where p.sandbox_id = s.id
        ), '[]'::jsonb)
      )
    ) order by s.removal_started_at nulls first, s.expires_at), '[]'::jsonb)
  from (
    select * from private.demo_sandboxes
    where expires_at <= now()
    order by removal_started_at nulls first, expires_at
    limit greatest(1, least(coalesce(batch_size, 5), 20))
  ) as s
$$;

-- Removes a district's data. Its identities are listed to be deleted first, in the same
-- transaction, so that none is forgotten whatever happens afterwards: the visitors' accounts and
-- every identity made for it that the district did not take in as shared background staff.
create or replace function private.demo_remove(target_sandbox uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  target_classes uuid[];
  target_schools uuid[];
  target_clusters uuid[];
  target_blocks uuid[];
  target_students uuid[];
  target_accounts uuid[];
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox for update;
  if not found then
    return false;
  end if;
  perform set_config('agla.demo_work', 'on', true);
  update private.demo_sandboxes set status = 'removing' where id = target_sandbox;

  select coalesce(array_agg(class_section_id), '{}'), coalesce(array_agg(distinct school_id), '{}')
  into target_classes, target_schools
  from private.demo_places where sandbox_id = target_sandbox;
  select coalesce(array_agg(distinct cluster_id), '{}') into target_clusters from public.schools where id = any (target_schools);
  select coalesce(array_agg(id), '{}') into target_blocks from public.blocks where district_id = sandbox.district_id;
  select coalesce(array_agg(id), '{}') into target_students from public.students where school_id = any (target_schools);
  select coalesce(array_agg(user_id), '{}') into target_accounts from private.demo_accounts where sandbox_id = target_sandbox;

  insert into private.demo_users_to_delete (user_id)
  select user_id from private.demo_accounts where sandbox_id = target_sandbox
  union
  select c.user_id from private.demo_created_users as c
  where c.sandbox_id = target_sandbox
    and not exists (select 1 from private.demo_people as p where p.user_id = c.user_id)
  on conflict (user_id) do nothing;

  delete from public.exam_result_shares where class_section_id = any (target_classes);
  delete from public.exams where school_id = any (target_schools) or cluster_id = any (target_clusters);
  delete from public.class_notes where class_section_id = any (target_classes);
  delete from public.visits where class_section_id = any (target_classes) and follows_visit_id is not null;
  delete from public.visits where class_section_id = any (target_classes);
  delete from public.visit_requests where class_section_id = any (target_classes);
  delete from public.crp_tasks where cluster_id = any (target_clusters);
  delete from public.pulse_reviews where class_section_id = any (target_classes);
  delete from public.pulse_scores where class_section_id = any (target_classes);
  delete from public.pulse_score_failures where check_id in (
    select id from public.pulse_checks where class_section_id = any (target_classes)
  );
  delete from public.pulse_checks where class_section_id = any (target_classes) and attempt = 2;
  delete from public.pulse_checks where class_section_id = any (target_classes);
  delete from public.pulse_samples where class_section_id = any (target_classes) and replaces_sample_id is not null;
  delete from public.pulse_cycles where class_section_id = any (target_classes);
  delete from public.pulse_samples where class_section_id = any (target_classes);
  delete from public.attendance_sessions where class_section_id = any (target_classes);
  delete from public.guardian_consents where student_id = any (target_students);
  delete from public.enrolments where student_id = any (target_students);
  delete from public.students where id = any (target_students);
  delete from public.class_teachers where class_section_id = any (target_classes);
  delete from private.demo_places where sandbox_id = target_sandbox;
  delete from public.class_sections where id = any (target_classes);
  delete from public.staff_assignments
  where school_id = any (target_schools) or cluster_id = any (target_clusters) or block_id = any (target_blocks)
     or district_id = sandbox.district_id;
  delete from private.ai_usage where profile_id = any (target_accounts);
  delete from public.schools where id = any (target_schools);
  delete from public.clusters where id = any (target_clusters);
  delete from public.blocks where id = any (target_blocks);
  delete from public.districts where id = sandbox.district_id;
  delete from private.demo_sandboxes where id = target_sandbox;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Opening and building
-- ---------------------------------------------------------------------------------------------

-- Starts a district for a visitor, unless no academic session covers today (`unavailable`), too
-- many are in use (`busy`) or the visitor's network started many in the last hour (`throttled`).
-- Visitors opening at the same moment are taken one after the other, so the limits hold exactly.
create or replace function private.demo_open(client_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key constant text := left(coalesce(nullif(btrim(client_key), ''), 'unknown'), 128);
  today_date constant date := (now() at time zone 'Asia/Kolkata')::date;
  sandbox private.demo_sandboxes;
  opened integer;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('agla.demo_open'));

  -- A district lives in the current academic session; one is never made up for it.
  if not exists (
    select 1 from public.academic_years where today_date between starts_on and ends_on
  ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- A district whose building stopped half-way is removed with the expired ones.
  update private.demo_sandboxes
  set expires_at = now()
  where status = 'building' and created_at < now() - interval '15 minutes' and expires_at > now();

  -- When all places are taken, the oldest district opened more than a day ago makes way.
  if (select count(*) from private.demo_sandboxes where expires_at > now()) >= 25 then
    update private.demo_sandboxes
    set expires_at = now()
    where id = (
      select id from private.demo_sandboxes
      where expires_at > now() and created_at < now() - interval '1 day'
      order by created_at
      limit 1
    );
  end if;
  if (select count(*) from private.demo_sandboxes where expires_at > now()) >= 25
     or (select count(*) from private.demo_sandboxes where created_at > now() - interval '1 day') >= 100
  then
    return jsonb_build_object('status', 'busy');
  end if;
  -- Judges or a class of trainees may share one network: twenty an hour from one network.
  select count(*), min(s.created_at) into opened, oldest
  from private.demo_sandboxes as s
  where s.client_key = key and s.created_at > now() - interval '1 hour';
  if opened >= 20 then
    return jsonb_build_object(
      'status', 'throttled',
      'retry_after_seconds', greatest(60, ceil(extract(epoch from oldest + interval '1 hour' - now())))::integer
    );
  end if;

  insert into private.demo_sandboxes (client_key) values (key) returning * into sandbox;
  return jsonb_build_object('status', 'ok', 'sandbox', sandbox.id);
end;
$$;

-- The fingerprint of stored feedback, computed as `_shared/feedback-fingerprint.ts` does (the
-- demonstration builder computes it the same way).
create function private.feedback_fingerprint_of(feedback public.visit_feedback)
returns text
language sql
stable
set search_path = ''
as $$
  select private.demo_fingerprint(
    feedback.strength,
    array(
      select case when entry ? 'moment' then 'moment:' || (entry ->> 'moment') else 'item:' || (entry ->> 'item') end
      from jsonb_array_elements(feedback.evidence) as entry
    ),
    feedback.practice_code,
    feedback.change_note,
    feedback.technique,
    feedback.demo_given,
    feedback.plan_note,
    feedback.check_back_on
  )
$$;

-- Builds one step of a demonstration district. Steps of one district never run at the same time,
-- and its classes are only ever placed in a real academic session.
create or replace function private.demo_build(target_sandbox uuid, phase text, details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform 1 from private.demo_sandboxes where id = target_sandbox and status = 'building' for update;
  if not found then
    raise exception 'There is no such demonstration district being built.' using errcode = '22023';
  end if;
  if phase = 'places' and not exists (
    select 1 from public.academic_years
    where (now() at time zone 'Asia/Kolkata')::date between starts_on and ends_on
  ) then
    raise exception 'No academic session covers today.' using errcode = '22023';
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

  if phase = 'coaching' then
    -- A check-back falls on a school day, as a CRP would choose it, within the days allowed after
    -- the visit; the scores are of the feedback as it now reads.
    update public.visit_feedback as f
    set check_back_on = next_day.day
    from public.visits as v
    join private.demo_places as p on p.class_section_id = v.class_section_id
    cross join lateral (
      select min(d) as day from private.demo_school_days(v.visited_on + 1, v.visited_on + 42) as d
      where d >= (select f2.check_back_on from public.visit_feedback as f2 where f2.visit_id = v.id)
    ) as next_day
    where f.visit_id = v.id
      and p.sandbox_id = target_sandbox
      and next_day.day is not null
      and next_day.day <> f.check_back_on;
    update public.visit_feedback_scores as sc
    set feedback_fingerprint = private.feedback_fingerprint_of(f)
    from public.visit_feedback as f
    join public.visits as v on v.id = f.visit_id
    join private.demo_places as p on p.class_section_id = v.class_section_id
    where sc.visit_id = f.visit_id
      and p.sandbox_id = target_sandbox
      and sc.feedback_fingerprint <> ''
      and sc.feedback_fingerprint <> private.feedback_fingerprint_of(f);
  end if;

  perform set_config('agla.demo_today', '', true);
  perform set_config('agla.demo_work', '', true);
  return result;
end;
$$;

-- The sample recordings wait in the classes the CRP visits next, whatever day of the week the
-- district is built.
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
      -- A child of this week first: their check is the newest the CRP will see.
      and (s.due_on >= sandbox.built_on or v.id is null)
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
    order by (v.id is null), (k.id is not null), private.demo_rand(s.id::text || (recording ->> 'key'))
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

-- ---------------------------------------------------------------------------------------------
-- The sweep
-- ---------------------------------------------------------------------------------------------

-- Asks the Edge Function to remove expired districts and delete the identities still listed.
-- Does nothing (with a notice) until the project URL is in Vault and the network extension is
-- installed.
create or replace function private.request_demo_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  token text := private.job_token('demo');
begin
  -- A district whose building stopped half-way goes too, even if no visitor opens another.
  update private.demo_sandboxes
  set expires_at = now()
  where status = 'building' and created_at < now() - interval '15 minutes' and expires_at > now();

  if not exists (select 1 from private.demo_sandboxes where expires_at <= now())
     and not exists (select 1 from private.demo_users_to_delete)
  then
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
  then
    raise notice 'Vault or pg_net is not available; expired demonstration districts were kept.';
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into project_url
    using 'project_url';
  if project_url is null or token is null then
    raise notice 'The project URL is not in Vault yet; expired demonstration districts were kept.';
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using
      rtrim(project_url, '/') || '/functions/v1/demo',
      jsonb_build_object('Content-Type', 'application/json', 'x-job-token', token),
      jsonb_build_object('action', 'sweep');
end;
$$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the demonstration sweep was not rescheduled.';
    return;
  end if;
  perform cron.schedule('demo-sweep', '*/15 * * * *', 'select private.request_demo_sweep()');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Service functions for the `demo` and `sahayak` Edge Functions
-- ---------------------------------------------------------------------------------------------

create function public.service_demo_note_account(target_sandbox uuid, target_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  select private.demo_note_account(target_sandbox, target_user_id)
$$;

create function public.service_demo_accounts_to_delete(batch_size integer default 60)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.demo_accounts_to_delete(batch_size)
$$;

create function public.service_demo_account_deleted(target_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  select private.demo_account_deleted(target_user_id)
$$;

create function public.service_demo_removing(target_sandbox uuid)
returns void
language sql
set search_path = ''
as $$
  select private.demo_removing(target_sandbox)
$$;

create function public.service_is_demo_account(target_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_demo_account(target_user_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Demonstration districts stay out of everything real
-- ---------------------------------------------------------------------------------------------

-- What a visitor does in their district is not part of the audit trail either.
create or replace function private.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  changed jsonb;
begin
  if private.demo_work() or auth.uid() = any (private.demo_user_ids()) then
    return null;
  end if;

  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
    into changed
    from jsonb_each(new_row) as n
    join jsonb_each(old_row) as o on o.key = n.key
    where n.value is distinct from o.value
      and n.key <> 'updated_at';

    if changed is null then
      return null;
    end if;
  else
    changed := coalesce(new_row, old_row);
  end if;

  insert into public.audit_events (actor_id, actor_role, table_name, operation, record_id, changes)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'role', 'system'),
    tg_table_name,
    tg_op,
    coalesce(new_row, old_row) ->> 'id',
    changed
  );

  return null;
end;
$$;

-- A demonstration district's rows are seen only by its visitors' accounts (and the other
-- demonstration accounts, all of them simulated): real staff, administrators included, never see
-- its geography, schools, classes, children or people. Restrictive policies narrow what the
-- existing policies allow; they grant nothing.
create policy "Demonstration states are seen only by demonstration accounts" on public.states
  as restrictive for select to authenticated
  using (code <> 'DEMO' or (select private.is_demo_caller()));

create policy "Demonstration districts are seen only by demonstration accounts" on public.districts
  as restrictive for select to authenticated
  using (not (id = any ((select private.demo_district_ids())::uuid[])) or (select private.is_demo_caller()));

create policy "Demonstration blocks are seen only by demonstration accounts" on public.blocks
  as restrictive for select to authenticated
  using (
    not (district_id = any ((select private.demo_district_ids())::uuid[])) or (select private.is_demo_caller())
  );

create policy "Demonstration clusters are seen only by demonstration accounts" on public.clusters
  as restrictive for select to authenticated
  using (not (id = any ((select private.demo_cluster_ids())::uuid[])) or (select private.is_demo_caller()));

create policy "Demonstration schools are seen only by demonstration accounts" on public.schools
  as restrictive for select to authenticated
  using (not (id = any ((select private.demo_school_ids())::uuid[])) or (select private.is_demo_caller()));

create policy "Demonstration classes are seen only by demonstration accounts" on public.class_sections
  as restrictive for select to authenticated
  using (
    not (school_id = any ((select private.demo_school_ids())::uuid[])) or (select private.is_demo_caller())
  );

create policy "Demonstration children are seen only by demonstration accounts" on public.students
  as restrictive for select to authenticated
  using (
    not (school_id = any ((select private.demo_school_ids())::uuid[])) or (select private.is_demo_caller())
  );

create policy "Demonstration people are seen only by demonstration accounts" on public.profiles
  as restrictive for select to authenticated
  using (not (id = any ((select private.demo_user_ids())::uuid[])) or (select private.is_demo_caller()));

create policy "Demonstration postings are seen only by demonstration accounts" on public.staff_assignments
  as restrictive for select to authenticated
  using (
    not (user_id = any ((select private.demo_user_ids())::uuid[])) or (select private.is_demo_caller())
  );

-- ---------------------------------------------------------------------------------------------
-- The office's report
-- ---------------------------------------------------------------------------------------------

-- As before, except that a score counts only for the feedback it scored (feedback changed since
-- is scored again), and that every timed child counts in the median speed: one who did not reach
-- the passage read no words of it.
create or replace function private.area_report(month_count integer)
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
    where s.is_active and not (s.id = any (private.demo_school_ids()));
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
      -- A score counts only for the feedback as it was agreed when scored, and as it still reads
      -- (a score kept before fingerprints were recorded is judged by the agreement alone).
      case
        when sc.feedback_agreed_at = f.agreed_at
          and (sc.feedback_fingerprint = '' or sc.feedback_fingerprint = private.feedback_fingerprint_of(f))
          then sc.total
      end as score,
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
      -- read none of it: no words a minute, below the Lakshya.
      (ch.mode = 'recorded' and p.check_id is not null and not sure.unsure) as timed,
      case
        when ch.mode = 'recorded' and p.check_id is not null and not sure.unsure
          then case when p.reached_level = 'passage' then p.wcpm else 0 end
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

-- ---------------------------------------------------------------------------------------------
-- Family sign-in
-- ---------------------------------------------------------------------------------------------

alter table private.family_credentials add column last_failed_at timestamptz;

comment on column private.family_credentials.last_failed_at is
  'The latest wrong PIN; failures older than a day are forgotten.';

-- Wrong PINs tried with learner codes that do not exist, counted and locked exactly like real
-- ones, by a hash of the code.
create table private.family_sign_in_decoys (
  hashed_code text primary key,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz,
  constraint family_sign_in_decoys_hashed_code_format check (hashed_code ~ '^[0-9a-f]{64}$'),
  constraint family_sign_in_decoys_failed_attempts_range check (failed_attempts between 0 and 1000)
);

comment on table private.family_sign_in_decoys is
  'Failures with unknown learner codes, so that a lock never tells a real code from a made-up one.';

alter table private.family_sign_in_decoys enable row level security;
revoke all on table private.family_sign_in_decoys from public, anon, authenticated;
grant select, insert, update, delete on table private.family_sign_in_decoys to service_role;

-- Until when a code is locked after `attempts` failures in a row: 15 minutes after the fifth,
-- doubling with each further one up to a day.
create function private.family_pin_lock(attempts integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when attempts >= 5
      then now() + least(interval '15 minutes' * power(2, least(attempts - 5, 10)), interval '24 hours')
  end
$$;

create or replace function public.service_set_family_pin(target_student_id uuid, pin text, issued_by uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if pin is null or pin !~ '^[0-9]{6}$' then
    raise exception 'A PIN must have exactly six digits.' using errcode = '22023';
  end if;

  insert into private.family_credentials (student_id, pin_hash, issued_by)
  values (target_student_id, extensions.crypt(pin, extensions.gen_salt('bf', 10)), issued_by)
  on conflict (student_id) do update
  set pin_hash = excluded.pin_hash,
      failed_attempts = 0,
      locked_until = null,
      last_failed_at = null,
      issued_by = excluded.issued_by,
      issued_at = now();
end;
$$;

-- Checks a learner code and PIN on behalf of a client network. Returns
-- `{"status": "ok", "user_id": ...}`, `{"status": "invalid"}`,
-- `{"status": "locked", "retry_after_seconds": n}` or `{"status": "throttled", "retry_after_seconds": n}`.
--
-- An unknown code and a wrong PIN give the same answers and take the same time: a PIN hash is
-- computed either way, and wrong PINs are counted and locked for an unknown code as for a real one.
-- After five failures in a row the code locks for 15 minutes, doubling with each further failure up
-- to 24 hours; failures more than a day old are forgotten. Every failure also counts against the
-- client network.
create or replace function public.service_verify_family_pin(learner_code text, pin text, client_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  credential record;
  decoy record;
  hashed text;
  attempts integer;
  lock_until timestamptz;
  throttle record;
  client constant text := coalesce(nullif(btrim(client_key), ''), 'unknown');
begin
  select failures, window_started_at into throttle
  from private.family_sign_in_throttle
  where family_sign_in_throttle.client_key = client;

  if found and throttle.window_started_at > now() - interval '1 hour' and throttle.failures >= 30 then
    return jsonb_build_object(
      'status', 'throttled',
      'retry_after_seconds',
      ceil(extract(epoch from throttle.window_started_at + interval '1 hour' - now()))::integer
    );
  end if;

  if learner_code is null or learner_code !~ '^[1-9][0-9]{9}$' or pin is null or pin !~ '^[0-9]{6}$' then
    perform private.record_family_sign_in_failure(client);
    return jsonb_build_object('status', 'invalid');
  end if;

  select c.student_id, c.pin_hash, c.failed_attempts, c.locked_until, c.last_failed_at, s.auth_user_id
  into credential
  from public.students as s
  join private.family_credentials as c on c.student_id = s.id
  join public.profiles as p on p.id = s.auth_user_id
  where s.student_code = learner_code
    and s.status = 'active'
    and p.is_active
  for update of c;

  if not found then
    -- The same steps as for a real code, in the same order, so that neither the answers nor the
    -- time they take reveal which codes exist.
    hashed := encode(extensions.digest(learner_code, 'sha256'), 'hex');
    insert into private.family_sign_in_decoys (hashed_code) values (hashed)
    on conflict (hashed_code) do nothing;
    select d.failed_attempts, d.locked_until, d.last_failed_at into decoy
    from private.family_sign_in_decoys as d
    where d.hashed_code = hashed
    for update;
    perform private.record_family_sign_in_failure(client);
    if decoy.locked_until is not null and decoy.locked_until > now() then
      return jsonb_build_object(
        'status', 'locked',
        'retry_after_seconds', ceil(extract(epoch from decoy.locked_until - now()))::integer
      );
    end if;
    perform extensions.crypt(pin, extensions.gen_salt('bf', 10));
    attempts := case
      when decoy.last_failed_at is null or decoy.last_failed_at < now() - interval '1 day' then 1
      else decoy.failed_attempts + 1
    end;
    lock_until := private.family_pin_lock(attempts);
    update private.family_sign_in_decoys
    set failed_attempts = least(attempts, 1000), locked_until = lock_until, last_failed_at = now()
    where hashed_code = hashed;
    if lock_until is not null then
      return jsonb_build_object(
        'status', 'locked',
        'retry_after_seconds', ceil(extract(epoch from lock_until - now()))::integer
      );
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;

  if credential.locked_until is not null and credential.locked_until > now() then
    perform private.record_family_sign_in_failure(client);
    return jsonb_build_object(
      'status', 'locked',
      'retry_after_seconds', ceil(extract(epoch from credential.locked_until - now()))::integer
    );
  end if;

  if extensions.crypt(pin, credential.pin_hash) = credential.pin_hash then
    update private.family_credentials
    set failed_attempts = 0, locked_until = null, last_failed_at = null, last_sign_in_at = now()
    where student_id = credential.student_id;
    return jsonb_build_object('status', 'ok', 'user_id', credential.auth_user_id);
  end if;

  attempts := case
    when credential.last_failed_at is null or credential.last_failed_at < now() - interval '1 day' then 1
    else credential.failed_attempts + 1
  end;
  lock_until := private.family_pin_lock(attempts);

  update private.family_credentials
  set failed_attempts = least(attempts, 1000), locked_until = lock_until, last_failed_at = now()
  where student_id = credential.student_id;

  perform private.record_family_sign_in_failure(client);

  if lock_until is not null then
    return jsonb_build_object(
      'status', 'locked',
      'retry_after_seconds', ceil(extract(epoch from lock_until - now()))::integer
    );
  end if;
  return jsonb_build_object('status', 'invalid');
end;
$$;

-- The daily clean-up also forgets made-up codes nobody has tried for two days.
create or replace function private.purge_family_sign_in_throttle()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
  decoys bigint;
begin
  delete from private.family_sign_in_throttle where window_started_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  delete from private.family_sign_in_decoys
  where last_failed_at < now() - interval '2 days'
    and (locked_until is null or locked_until < now());
  get diagnostics decoys = row_count;
  return removed + decoys;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Consent
-- ---------------------------------------------------------------------------------------------

-- A decision kept on a phone before it could be sent is dated when it was taken (never in the
-- future, nor more than 30 days back), so that the latest decision is the one in force whatever
-- order phones send them in.
create or replace function private.stamp_guardian_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_user() then
    new.recorded_by := auth.uid();
    new.recorded_at := least(
      clock_timestamp(),
      greatest(coalesce(new.recorded_at, clock_timestamp()), clock_timestamp() - interval '30 days')
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Pulse
-- ---------------------------------------------------------------------------------------------

-- The passages and prompts the given children were given before, in any school, for the
-- children of the caller's own schools, so that a child who moved school is not given one twice.
create function private.pulse_items_seen_by(student_ids uuid[])
returns table (student_id uuid, item_code text, prompt_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.student_id, k.item_code, k.prompt_code
  from public.pulse_checks as k
  where k.student_id = any (student_ids[1:200])
    and exists (
      select 1 from public.students as s
      where s.id = k.student_id and s.school_id = any (private.teacher_school_ids())
    )
$$;

create function public.pulse_items_seen(student_ids uuid[])
returns table (student_id uuid, item_code text, prompt_code text)
language sql
stable
set search_path = ''
as $$
  select * from private.pulse_items_seen_by(student_ids)
$$;

comment on function public.pulse_items_seen(uuid[]) is
  'Passages and prompts the children of the caller''s schools were given before, in any school.';

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on function private.demo_cluster_ids() from public;
revoke all on function private.is_demo_caller() from public;
revoke all on function private.is_demo_account(uuid) from public;
revoke all on function private.demo_note_account(uuid, uuid) from public;
revoke all on function private.demo_accounts_to_delete(integer) from public;
revoke all on function private.demo_account_deleted(uuid) from public;
revoke all on function private.demo_removing(uuid) from public;
revoke all on function private.feedback_fingerprint_of(public.visit_feedback) from public;
revoke all on function private.family_pin_lock(integer) from public;
revoke all on function private.pulse_items_seen_by(uuid[]) from public;
revoke all on function public.pulse_items_seen(uuid[]) from public, anon;
revoke all on function public.service_demo_note_account(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_demo_accounts_to_delete(integer) from public, anon, authenticated;
revoke all on function public.service_demo_account_deleted(uuid) from public, anon, authenticated;
revoke all on function public.service_demo_removing(uuid) from public, anon, authenticated;
revoke all on function public.service_is_demo_account(uuid) from public, anon, authenticated;

grant execute on function
  private.demo_cluster_ids(),
  private.is_demo_caller(),
  private.pulse_items_seen_by(uuid[]),
  public.pulse_items_seen(uuid[])
  to authenticated, service_role;
grant execute on function
  private.is_demo_account(uuid),
  private.demo_note_account(uuid, uuid),
  private.demo_accounts_to_delete(integer),
  private.demo_account_deleted(uuid),
  private.demo_removing(uuid),
  private.family_pin_lock(integer),
  public.service_demo_note_account(uuid, uuid),
  public.service_demo_accounts_to_delete(integer),
  public.service_demo_account_deleted(uuid),
  public.service_demo_removing(uuid),
  public.service_is_demo_account(uuid)
  to service_role;
