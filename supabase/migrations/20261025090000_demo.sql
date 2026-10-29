-- Demonstration districts.
--
-- Anyone may try the application without an account: a visitor picks a role (teacher, CRP, block
-- education officer or family) and receives a district of their own, with months of history up to
-- today. Everything in it is simulated, and the application says so on every screen. A district is
-- kept for three days and then removed with its accounts; a visitor who comes later receives a new
-- one, built afresh for that day.
--
-- The `demo` Edge Function builds a district in steps, each a call of `service_demo_build`, because
-- accounts can only be created through the Auth service:
--   1. `places`: the district, its block, two clusters of eight schools, Classes 1 to 3 of every
--      school, the children with their families' consent for audio checks, and their enrolments.
--   2. The function creates the visitor's four accounts (and, the first time, the background staff
--      that every demonstration district shares), then `people` posts them to their schools.
--   3. `attendance`, `pulse`, `coaching`, `exams` and `notes` write the history.
--   4. `finish` places the sample recordings and marks the district ready.
--
-- History is written as the application would have written it, each day on its own date: the
-- builder sets `agla.demo_work` and `agla.demo_today` for its own transaction, and `private.today()`
-- answers with that day, so every rule of the schema holds as it would have held then. Only trusted
-- roles (never an API user) can set them, and only the builder does.
--
-- Demonstration districts are kept out of everything real: the platform overview, the
-- administrator's area report, the audit trail, and the engine's queue and agreement figures.

-- ---------------------------------------------------------------------------------------------
-- The date a demonstration is written on
-- ---------------------------------------------------------------------------------------------

create or replace function private.today()
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case
      when current_user not in ('anon', 'authenticated')
           and current_setting('agla.demo_work', true) = 'on'
      then nullif(current_setting('agla.demo_today', true), '')::date
    end,
    (now() at time zone 'Asia/Kolkata')::date
  )
$$;

comment on function private.today() is
  'Calendar date in India; while a demonstration district is written, the day being written.';

-- Whether the statement runs as part of building or removing a demonstration district.
create function private.demo_work()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('anon', 'authenticated')
    and coalesce(current_setting('agla.demo_work', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table private.demo_sandboxes (
  id uuid primary key default gen_random_uuid(),
  serial integer generated always as identity,
  client_key text not null,
  status text not null default 'building',
  district_id uuid references public.districts (id) on delete set null,
  built_on date,
  history_from date,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  expires_at timestamptz not null default now() + interval '3 days',
  constraint demo_sandboxes_serial_key unique (serial),
  constraint demo_sandboxes_status_valid check (status in ('building', 'ready', 'removing')),
  constraint demo_sandboxes_client_key_length check (char_length(client_key) between 1 and 128)
);

comment on table private.demo_sandboxes is
  'Demonstration districts, one for each visitor, removed with their accounts when they expire.';

create index demo_sandboxes_client_key_idx on private.demo_sandboxes (client_key, created_at);
create index demo_sandboxes_expires_at_idx on private.demo_sandboxes (expires_at);

create table private.demo_places (
  class_section_id uuid primary key references public.class_sections (id) on delete cascade,
  sandbox_id uuid not null references private.demo_sandboxes (id) on delete cascade,
  school_id uuid not null,
  school_index smallint not null,
  cluster_index smallint not null,
  grade smallint not null,
  medium text not null
);

comment on table private.demo_places is
  'The classes of each demonstration district, with the place of their school in it.';

create index demo_places_sandbox_id_idx on private.demo_places (sandbox_id);

-- The background staff: teachers and a CRP who appear in every demonstration district under the
-- same names. They never sign in.
create table private.demo_people (
  slot text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  constraint demo_people_user_id_key unique (user_id),
  constraint demo_people_slot_format check (slot ~ '^(teacher|crp)-[0-9]{2}$')
);

comment on table private.demo_people is
  'Simulated staff shared by every demonstration district; they never sign in.';

create table private.demo_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sandbox_id uuid not null references private.demo_sandboxes (id) on delete cascade,
  role text not null,
  email text not null,
  constraint demo_accounts_sandbox_role_key unique (sandbox_id, role),
  constraint demo_accounts_role_valid check (role in ('teacher', 'crp', 'officer', 'family'))
);

comment on table private.demo_accounts is
  'The four accounts of each demonstration district through which its visitor signs in.';

alter table private.demo_sandboxes enable row level security;
alter table private.demo_places enable row level security;
alter table private.demo_people enable row level security;
alter table private.demo_accounts enable row level security;

revoke all on table private.demo_sandboxes from anon, authenticated;
revoke all on table private.demo_places from anon, authenticated;
revoke all on table private.demo_people from anon, authenticated;
revoke all on table private.demo_accounts from anon, authenticated;

-- The engine's queue reads which classes are simulated.
grant select on table private.demo_places, private.demo_sandboxes to service_role;

-- Every school of a demonstration district.
create function private.demo_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.school_id), '{}')
  from private.demo_places as p
$$;

-- Every demonstration district, and every account of one (visitors' and background staff).
create function private.demo_district_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(district_id), '{}') from private.demo_sandboxes where district_id is not null
$$;

create function private.demo_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(user_id), '{}')
  from (
    select user_id from private.demo_people
    union all
    select user_id from private.demo_accounts
  ) as everyone
$$;

-- ---------------------------------------------------------------------------------------------
-- Kept out of everything real
-- ---------------------------------------------------------------------------------------------

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
  -- A demonstration district's own writing is not part of the audit trail.
  if private.demo_work() then
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

-- Notes removed when their district is removed leave no tombstone behind.
create or replace function private.record_class_note_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.demo_work() then
    return old;
  end if;
  insert into private.class_note_removals (note_id, class_section_id)
  values (old.id, old.class_section_id)
  on conflict do nothing;
  return old;
end;
$$;

-- The guard of Pulse checks, unchanged except that a demonstration district's history is written
-- with its recordings' details as they were: files past the listening window were removed long
-- ago, as they would have been.
create or replace function private.guard_pulse_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sample record;
  first_attempt record;
  audio record;
  checked_day date;
begin
  select * into sample from private.pulse_sample_context(new.sample_id);
  if not found then
    raise exception 'This child was not drawn for Pulse.' using errcode = '23503';
  end if;

  -- Taken from the draw, never from the device.
  new.class_section_id := sample.class_section_id;
  new.student_id := sample.student_id;

  if sample.adapted <> (new.mode = 'adapted') then
    raise exception 'This child receives the % check.',
      case when sample.adapted then 'adapted' else 'recorded' end
      using errcode = '23514';
  end if;

  if private.demo_work() then
    return new;
  end if;

  if private.is_api_user() then
    new.recorded_by := auth.uid();
    new.received_at := now();
    new.audio_deleted_at := null;

    if not coalesce(
      private.class_section_school_id(sample.class_section_id) = any (private.teacher_school_ids()),
      false
    ) then
      raise exception 'Only teachers of the school can record Pulse checks.' using errcode = '42501';
    end if;
    if new.mode = 'recorded' and not private.has_guardian_consent(sample.student_id, 'audio_assessment') then
      raise exception 'The family has withdrawn consent for audio checks.' using errcode = '42501';
    end if;

    if sample.week is null or sample.opens_on > private.today() then
      raise exception 'This child is not due for a check.' using errcode = '42501';
    end if;
    if sample.replaced_at is not null and new.recorded_at > sample.replaced_at then
      raise exception 'This child was replaced by another child before the check was made.'
        using errcode = '23514';
    end if;
    checked_day := (new.recorded_at at time zone 'Asia/Kolkata')::date;
    if checked_day < sample.opens_on
       or checked_day > private.pulse_week_end(sample.month, 5::smallint)
       or new.recorded_at > now() + interval '5 minutes'
    then
      raise exception 'The recording time is outside the child''s check period. Check the date and time on the device.'
        using errcode = '23514';
    end if;
    if private.today() > private.pulse_week_end(sample.month, 5::smallint) + 31 then
      raise exception 'Checks of a month can be sent for up to 31 days after it ends.'
        using errcode = '42501';
    end if;
  end if;

  if new.mode = 'adapted' then
    new.item_seen_before := false;
    new.audio_etag := null;
    return new;
  end if;

  -- The passage is in the class's language and both items are of the class's grade.
  if new.item_code !~ ('^' || sample.language || '-g' || sample.grade::text || '-p[0-9]{2}$')
     or new.prompt_code !~ ('^en-g' || sample.grade::text || '-s[0-9]{2}$')
  then
    raise exception 'The passage or the prompt is not one for this class.' using errcode = '23514';
  end if;

  if new.attempt = 2 then
    select k.classroom, k.item_code, k.prompt_code into first_attempt
    from public.pulse_checks as k
    where k.sample_id = new.sample_id and k.attempt = 1;
    if not found then
      -- Not a refusal: the first recording may still be on its way from the same device.
      raise exception 'The first recording of this child has not arrived yet.' using errcode = '55000';
    end if;
    if first_attempt.classroom is distinct from 'noisy' then
      raise exception 'A second recording is allowed only after a recording in a noisy classroom.'
        using errcode = '23514';
    end if;
    if first_attempt.item_code = new.item_code or first_attempt.prompt_code = new.prompt_code then
      raise exception 'A second recording must use a different passage and prompt.'
        using errcode = '23514';
    end if;
  end if;

  if private.pulse_audio_class_section(new.audio_path) is distinct from new.class_section_id
     or private.pulse_audio_sample(new.audio_path) is distinct from new.sample_id
     or split_part(split_part(new.audio_path, '/', 3), '.', 1) <> new.id::text
  then
    raise exception 'The recording is not stored where this check expects it.'
      using errcode = '23514';
  end if;

  select o.owner_id, o.metadata into audio
  from private.pulse_audio_object(new.audio_path) as o;
  if not found then
    -- Not a refusal: the device uploads the recording again on its next attempt (for example when
    -- an upload no check had claimed for days was tidied away in between).
    raise exception 'The recording has not been uploaded.' using errcode = '55000';
  end if;
  if private.is_api_user() and audio.owner_id is distinct from auth.uid()::text then
    raise exception 'The recording was uploaded by someone else.' using errcode = '42501';
  end if;
  new.audio_type := coalesce(audio.metadata ->> 'mimetype', '');
  new.audio_bytes := coalesce((audio.metadata ->> 'size')::integer, 0);
  if new.audio_type not in ('audio/webm', 'audio/ogg', 'audio/mp4') then
    raise exception 'The recording is not in a supported format.' using errcode = '23514';
  end if;
  -- The same file sent again for another check (a resend of this check keeps its id).
  new.audio_etag := nullif(audio.metadata ->> 'eTag', '');
  if new.audio_etag is not null and private.pulse_audio_reused(new.audio_etag, new.id) then
    raise exception 'This recording was already sent for another check.' using errcode = '23514';
  end if;

  new.item_seen_before := private.pulse_item_seen(new.student_id, new.item_code, new.prompt_code);
  return new;
end;
$$;

-- The engine scores what teachers recorded, never the history a demonstration district was built
-- with; what visitors record there is scored like any other check.
create or replace function public.service_pulse_checks_to_score(batch_size integer, current_engine text)
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
    and not exists (
      select 1
      from private.demo_places as dp
      join private.demo_sandboxes as ds on ds.id = dp.sandbox_id
      where dp.class_section_id = k.class_section_id
        and (ds.ready_at is null or k.received_at <= ds.ready_at)
    )
  order by (p.check_id is not null), coalesce(f.attempts, 0), k.received_at
  limit greatest(1, least(coalesce(batch_size, 50), 500))
$$;

-- The agreement between teachers and the engine is measured on real checks only.
create or replace function public.service_pulse_agreement(since timestamptz, current_engine text)
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
    and not exists (
      select 1 from private.demo_places as dp where dp.class_section_id = k.class_section_id
    )
  group by 1, 2, 3, 4
$$;

-- The platform overview counts real places, people and children only.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  demo_schools constant uuid[] := private.demo_school_ids();
  demo_districts constant uuid[] := private.demo_district_ids();
  demo_users constant uuid[] := private.demo_user_ids();
begin
  if not private.is_super_admin() then
    raise exception 'Only a super administrator can view the platform overview.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'schools', (
      select count(*) from public.schools where is_active and not (id = any (demo_schools))
    ),
    'clusters', (
      select count(*) from public.clusters as c
      where not exists (
        select 1 from public.schools as s where s.cluster_id = c.id and s.id = any (demo_schools)
      )
    ),
    'blocks', (
      select count(*) from public.blocks as b
      where not exists (
        select 1
        from public.clusters as c
        join public.schools as s on s.cluster_id = c.id
        where c.block_id = b.id and s.id = any (demo_schools)
      )
    ),
    'districts', (
      select count(*) from public.districts where not (id = any (demo_districts))
    ),
    'staff', (
      select coalesce(jsonb_object_agg(role, total), '{}'::jsonb)
      from (
        select a.role, count(distinct a.user_id) as total
        from public.staff_assignments as a
        join public.profiles as p on p.id = a.user_id
        where p.is_active
          and a.starts_on <= private.today()
          and (a.ends_on is null or a.ends_on >= private.today())
          and not (a.user_id = any (demo_users))
        group by a.role
      ) as by_role
    ),
    'students', (
      select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
      from (
        select status, count(*) as total
        from public.students
        where not (school_id = any (demo_schools))
        group by status
      ) as by_status
    ),
    'family_accounts', (
      select count(*)
      from public.students as st
      join public.profiles as p on p.id = st.auth_user_id
      where st.status = 'active' and p.is_active and not (st.school_id = any (demo_schools))
    ),
    'current_academic_year', (
      select jsonb_build_object('id', id, 'label', label, 'starts_on', starts_on, 'ends_on', ends_on)
      from public.academic_years
      where private.today() between starts_on and ends_on
    )
  );
end;
$$;

-- The administrator's area report covers real schools only; an officer's area never includes a
-- demonstration district, and a demonstration officer's area is only theirs.
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

-- ---------------------------------------------------------------------------------------------
-- Building blocks
-- ---------------------------------------------------------------------------------------------

-- A number in [0, 1) that depends only on `key`: the same district always tells the same story.
create function private.demo_rand(key text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select ('x' || substr(md5(key), 1, 8))::bit(32)::bigint / 4294967296.0
$$;

create function private.demo_pick(choices text[], key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select choices[1 + floor(private.demo_rand(key) * cardinality(choices))::integer]
$$;

-- An identifier that depends only on `key`.
create function private.demo_id(key text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5(key)::uuid
$$;

-- School days: Monday to Saturday, outside the summer vacation (June) and the national holidays.
create function private.demo_school_days(first_day date, last_day date)
returns setof date
language sql
immutable
set search_path = ''
as $$
  select day::date
  from generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') as day
  where extract(isodow from day) < 7
    and extract(month from day) <> 6
    and to_char(day, 'MM-DD') not in ('01-26', '08-15', '10-02', '12-25')
$$;

-- Whether a child was absent on a day: each child has their own habit, the monsoon keeps a few
-- more at home, and now and then a whole class thins out (a wedding, a fair, heavy rain).
create function private.demo_absent(student uuid, class_section uuid, day date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.demo_rand(student::text || day::text)
    < 0.06
      + 0.16 * power(private.demo_rand(student::text || ':absence'), 3)
      + case when extract(month from day) in (7, 8) then 0.03 else 0 end
      + case when private.demo_rand(class_section::text || day::text) < 0.05 then 0.18 else 0 end
$$;

-- A local time of a day in India, `minutes` after midnight.
create function private.demo_at(day date, minutes double precision)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (day::timestamp + make_interval(secs => minutes * 60)) at time zone 'Asia/Kolkata'
$$;

-- How a child reads and speaks in a month of the demonstration (0 for the first): the level they
-- truly read at, the furthest step they reach, their words correct per minute on the passage, and
-- their spoken English. Children grow a little every month, more in the classes of the cluster
-- whose CRP coaches closely.
create function private.demo_child(
  student uuid,
  school uuid,
  grade integer,
  month_index integer,
  coached boolean
)
returns table (reading text, reached text, wcpm integer, english text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  ability constant double precision := private.demo_rand(student::text || ':reading');
  quality constant double precision := (private.demo_rand(school::text || ':quality') - 0.5) * 0.24;
  lower_bound constant double precision := case grade when 1 then 0.5 when 2 then 0.42 else 0.36 end;
  upper_bound constant double precision := case grade when 1 then 0.78 when 2 then 0.7 else 0.64 end;
  fluent_at constant integer := case grade when 1 then 28 when 2 then 45 else 60 end;
  score double precision;
  spoken double precision;
begin
  score := 0.12 + 0.72 * ability + quality
    + month_index * case when coached then 0.045 else 0.03 end;
  spoken := 0.08 + 0.72 * private.demo_rand(student::text || ':english') + quality
    + month_index * 0.035;

  if score < lower_bound then
    reading := 'needs_support';
    reached := case when score > lower_bound - 0.14 then 'words' else 'letters' end;
    wcpm := null;
  elsif score < upper_bound then
    reading := 'hesitant';
    if score > lower_bound + 0.06 then
      reached := 'passage';
      wcpm := round(fluent_at * (0.35 + 0.6 * (score - lower_bound) / (upper_bound - lower_bound)));
    else
      reached := 'words';
      wcpm := null;
    end if;
  else
    reading := 'fluent';
    reached := 'passage';
    wcpm := least(
      115,
      round(
        fluent_at + (score - upper_bound) * 120
          + 4 * private.demo_rand(student::text || ':pace' || month_index::text)
      )
    );
  end if;

  english := case
    when spoken > case grade when 1 then 0.8 else 0.7 end then 'sentences'
    when spoken > 0.36 then 'words'
    else 'no_response'
  end;
  return next;
end;
$$;

-- The level next to `level`, one step up or down.
create function private.demo_level_step(level text, up boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when up then case level when 'needs_support' then 'hesitant' else 'fluent' end
    else case level when 'fluent' then 'hesitant' else 'needs_support' end
  end
$$;

-- The fingerprint of feedback, computed exactly as `_shared/feedback-fingerprint.ts` does.
create function private.demo_fingerprint(
  strength text,
  evidence text[],
  practice_code text,
  change_note text,
  technique text,
  demo_given boolean,
  plan_note text,
  check_back_on date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        '[' || to_json(btrim(regexp_replace(coalesce(strength, ''), '\s+', ' ', 'g')))::text
          || ',' || coalesce(
            (select to_json(array_agg(entry order by entry collate "C"))::text
             from unnest(evidence) as entry),
            '[]'
          )
          || ',' || to_json(coalesce(practice_code, ''))::text
          || ',' || to_json(btrim(regexp_replace(coalesce(change_note, ''), '\s+', ' ', 'g')))::text
          || ',' || to_json(btrim(regexp_replace(coalesce(technique, ''), '\s+', ' ', 'g')))::text
          || ',' || case when demo_given then 'true' else 'false' end
          || ',' || to_json(btrim(regexp_replace(coalesce(plan_note, ''), '\s+', ' ', 'g')))::text
          || ',' || to_json(coalesce(check_back_on::text, ''))::text
          || ']',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------------------------

-- A child's name: most families of the district are Hindu, about one in seven Muslim.
create function private.demo_child_name(key text, female boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when private.demo_rand(key || ':community') < 0.14 then
      private.demo_pick(
        case when female
          then array['Ayesha', 'Zoya', 'Sana', 'Muskan', 'Alina', 'Mahira', 'Inaya', 'Fatima',
                     'Rukhsar', 'Afreen', 'Nazia', 'Sumaiya']
          else array['Ayaan', 'Arman', 'Faizan', 'Imran', 'Sahil', 'Rehan', 'Zaid', 'Arif',
                     'Shoaib', 'Danish', 'Saif', 'Adil']
        end,
        key || ':first'
      ) || ' ' || private.demo_pick(
        array['Ansari', 'Khan', 'Siddiqui', 'Qureshi', 'Malik', 'Shaikh'], key || ':family'
      )
    else
      private.demo_pick(
        case when female
          then array['Anjali', 'Priya', 'Pooja', 'Neha', 'Kajal', 'Khushi', 'Sakshi', 'Shivani',
                     'Nisha', 'Ritu', 'Sneha', 'Aarti', 'Komal', 'Kavya', 'Ananya', 'Payal',
                     'Rani', 'Sonam', 'Jyoti', 'Nandini', 'Radhika', 'Mansi', 'Tanu',
                     'Vaishnavi', 'Roshni', 'Pinki', 'Suhani', 'Aditi', 'Riya', 'Shalini']
          else array['Aman', 'Rahul', 'Rohit', 'Ankit', 'Vikas', 'Sachin', 'Arjun', 'Aditya',
                     'Shivam', 'Ravi', 'Suraj', 'Deepak', 'Mohit', 'Ajay', 'Karan', 'Vivek',
                     'Abhishek', 'Nitin', 'Ishaan', 'Krishna', 'Gaurav', 'Prince', 'Anuj',
                     'Harsh', 'Yash', 'Sonu', 'Ashish', 'Raju', 'Golu', 'Ansh']
        end,
        key || ':first'
      ) || ' ' || private.demo_pick(
        array['Yadav', 'Verma', 'Singh', 'Gupta', 'Maurya', 'Pal', 'Prajapati', 'Chauhan',
              'Rawat', 'Kushwaha', 'Saroj', 'Nishad', 'Pandey', 'Mishra', 'Tiwari', 'Sharma',
              'Rajbhar', 'Gautam', 'Sonkar', 'Kashyap', 'Patel', 'Vishwakarma', 'Lodhi',
              'Jaiswal', case when female then 'Kumari' else 'Kumar' end],
        key || ':family'
      )
  end
$$;

-- The name a guardian gives: the child's family name with a parent's first name.
create function private.demo_guardian_name(child_name text, key text, relationship text)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.demo_pick(
      case
        when split_part(child_name, ' ', 2) in ('Ansari', 'Khan', 'Siddiqui', 'Qureshi', 'Malik', 'Shaikh') then
          case relationship
            when 'mother' then array['Shabana', 'Nazma', 'Rubina', 'Shahnaz', 'Farzana', 'Shagufta']
            else array['Mohd. Rafiq', 'Salim', 'Shakeel', 'Naseem', 'Javed', 'Aslam']
          end
        else
          case relationship
            when 'mother' then array['Sunita', 'Geeta', 'Rekha', 'Seema', 'Pushpa', 'Meena',
                                     'Anita', 'Kiran', 'Savitri', 'Manju', 'Lalita', 'Sarla']
            else array['Ramesh', 'Suresh', 'Rajesh', 'Dinesh', 'Mukesh', 'Santosh', 'Manoj',
                       'Shyam', 'Vinod', 'Anil', 'Sunil', 'Pramod', 'Ashok', 'Kamlesh', 'Rambabu']
          end
      end,
      key || ':guardian'
    )
    || ' ' || case
      when split_part(child_name, ' ', 2) in ('Kumari', 'Kumar') then
        case relationship when 'mother' then 'Devi' else 'Kumar' end
      else split_part(child_name, ' ', 2)
    end
$$;

-- The background staff, by slot: two teachers in every school but the first (whose second teacher
-- is the visitor), and the CRP of the second cluster.
create function private.demo_staff_name(slot text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case slot
    when 'crp-01' then 'Sushma Yadav'
    else (array[
      'Sunita Devi', 'Rakesh Kumar Yadav', 'Meena Verma', 'Mohd. Irfan', 'Kiran Singh',
      'Pradeep Kumar Maurya', 'Shabnam Bano', 'Vijay Shankar Pandey', 'Neelam Gupta',
      'Arvind Kumar', 'Poonam Tiwari', 'Santosh Kumar Pal', 'Rekha Kushwaha', 'Dharmendra Singh',
      'Alka Srivastava', 'Mahesh Prasad', 'Farhana Khan', 'Anil Kumar Chauhan', 'Sarita Mishra',
      'Jitendra Rawat', 'Usha Rani', 'Ramkumar Nishad', 'Preeti Sharma', 'Shailendra Kumar',
      'Kusum Lata', 'Abdul Wahid', 'Mamta Saroj', 'Brijesh Kumar Patel', 'Sangeeta Rajbhar',
      'Ompal Singh', 'Nirmala Devi'
    ])[substr(slot, 9)::integer]
  end
$$;

-- The teacher slots of a school of the district (1 to 16).
create function private.demo_school_slots(school_index integer)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when school_index = 1 then array['teacher-01']
    else array[
      'teacher-' || lpad((2 * school_index - 2)::text, 2, '0'),
      'teacher-' || lpad((2 * school_index - 1)::text, 2, '0')
    ]
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Opening a district
-- ---------------------------------------------------------------------------------------------

-- Starts a district for a visitor, unless too many are in use (`busy`) or the visitor's network
-- started several in the last hour (`throttled`).
create function private.demo_open(client_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key constant text := left(coalesce(nullif(btrim(client_key), ''), 'unknown'), 128);
  sandbox private.demo_sandboxes;
begin
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
  if (
    select count(*) from private.demo_sandboxes as s
    where s.client_key = key and s.created_at > now() - interval '1 hour'
  ) >= 6 then
    return jsonb_build_object('status', 'throttled', 'retry_after_seconds', 3600);
  end if;

  insert into private.demo_sandboxes (client_key) values (key) returning * into sandbox;
  return jsonb_build_object('status', 'ok', 'sandbox', sandbox.id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Places and children
-- ---------------------------------------------------------------------------------------------

-- What the function must create next: the visitor's four accounts and any background staff not
-- created before, each with the place it is posted to.
create function private.demo_people_needed(target_sandbox uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with places as (
    select
      (select p.school_id from private.demo_places as p
       where p.sandbox_id = target_sandbox and p.school_index = 1 limit 1) as first_school,
      (select c.cluster_id from private.demo_places as p
       join public.schools as c on c.id = p.school_id
       where p.sandbox_id = target_sandbox and p.cluster_index = 1 limit 1) as first_cluster,
      (select c.cluster_id from private.demo_places as p
       join public.schools as c on c.id = p.school_id
       where p.sandbox_id = target_sandbox and p.cluster_index = 2 limit 1) as second_cluster,
      (select b.id from private.demo_sandboxes as s
       join public.blocks as b on b.district_id = s.district_id
       where s.id = target_sandbox limit 1) as block_id,
      (select (s.history_from - interval '27 months')::date from private.demo_sandboxes as s
       where s.id = target_sandbox) as posted_on,
      private.demo_id(target_sandbox::text || ':student:family') as family_student
  )
  select jsonb_build_object(
    'posted_on', places.posted_on,
    'accounts', jsonb_build_array(
      jsonb_build_object('role', 'teacher', 'full_name', 'Anita Sharma', 'scope', places.first_school),
      jsonb_build_object('role', 'crp', 'full_name', 'Rajeev Kumar Mishra', 'scope', places.first_cluster),
      jsonb_build_object('role', 'officer', 'full_name', 'Suresh Chandra Dubey', 'scope', places.block_id),
      jsonb_build_object('role', 'family', 'student', places.family_student)
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
          'slot', needed.slot,
          'full_name', private.demo_staff_name(needed.slot),
          'role', case when needed.slot like 'crp-%' then 'crp' else 'teacher' end,
          'scope', needed.scope)
        order by needed.slot)
      from (
        select slot.slot, p.school_id as scope
        from private.demo_places as p
        cross join lateral unnest(private.demo_school_slots(p.school_index)) as slot (slot)
        where p.sandbox_id = target_sandbox and p.grade = 1
        union all
        select 'crp-01', places.second_cluster
      ) as needed
      where not exists (select 1 from private.demo_people as x where x.slot = needed.slot)
    ), '[]'::jsonb)
  )
  from places
$$;

create function private.demo_build_places(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  today_date constant date := (now() at time zone 'Asia/Kolkata')::date;
  year public.academic_years;
  start_date date;
  start_year integer;
  demo_state uuid;
  new_district uuid;
  new_block uuid;
  new_cluster uuid;
  new_school uuid;
  new_class uuid;
  cluster_number integer;
  school_number integer;
  class_grade integer;
  class_medium text;
  villages_en constant text[] := array[
    'Bhagwanpur', 'Rampur', 'Kishanpur', 'Madhopur', 'Pipra Kalan', 'Belwa', 'Sukhpura', 'Gopalpur',
    'Sonpur', 'Chandpur', 'Lakhanpur', 'Barauli', 'Dhanaura', 'Shivnagar', 'Karanpur', 'Bhawanipur'
  ];
  villages_hi constant text[] := array[
    'भगवानपुर', 'रामपुर', 'किशनपुर', 'माधोपुर', 'पिपरा कलाँ', 'बेलवा', 'सुखपुरा', 'गोपालपुर',
    'सोनपुर', 'चाँदपुर', 'लखनपुर', 'बरौली', 'धनौरा', 'शिवनगर', 'करनपुर', 'भवानीपुर'
  ];
  family_class uuid;
  third_class uuid;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox for update;
  if sandbox.district_id is not null then
    return private.demo_people_needed(target_sandbox);
  end if;

  select * into year from public.academic_years as y where today_date between y.starts_on and y.ends_on;
  if not found then
    start_year := extract(year from today_date)::integer
      - case when extract(month from today_date) < 4 then 1 else 0 end;
    insert into public.academic_years (label, starts_on, ends_on)
    values (
      start_year::text || '-' || lpad(((start_year + 1) % 100)::text, 2, '0'),
      make_date(start_year, 4, 1),
      make_date(start_year + 1, 3, 31)
    )
    returning * into year;
  end if;
  start_date := greatest(year.starts_on, (date_trunc('month', today_date) - interval '3 months')::date);
  perform set_config('agla.demo_today', start_date::text, true);

  insert into public.states (code, name_en, name_hi)
  values ('DEMO', 'Demonstration', 'प्रदर्शन')
  on conflict (code) do nothing;
  select id into demo_state from public.states where code = 'DEMO';

  insert into public.districts (state_id, code, name_en, name_hi)
  values (demo_state, 'D' || lpad(sandbox.serial::text, 7, '0'), 'Nayagaon', 'नयागाँव')
  returning id into new_district;
  insert into public.blocks (district_id, code, name_en, name_hi)
  values (new_district, 'B1', 'Rampur', 'रामपुर')
  returning id into new_block;

  for cluster_number in 1 .. 2 loop
    insert into public.clusters (block_id, code, name_en, name_hi)
    values (
      new_block,
      'C' || cluster_number,
      (array['Rampur', 'Sonpur'])[cluster_number],
      (array['रामपुर', 'सोनपुर'])[cluster_number]
    )
    returning id into new_cluster;

    for school_number in (cluster_number - 1) * 8 + 1 .. cluster_number * 8 loop
      -- Three of the sixteen schools teach in English.
      class_medium := case when school_number in (4, 10, 14) then 'en' else 'hi' end;
      insert into public.schools (cluster_id, udise_code, name_en, name_hi, village)
      values (
        new_cluster,
        '99' || lpad((sandbox.serial % 1000000)::text, 6, '0') || lpad(school_number::text, 3, '0'),
        case when class_medium = 'en' then 'English Medium Primary School ' else 'Primary School ' end
          || villages_en[school_number],
        case when class_medium = 'en' then 'अंग्रेज़ी माध्यम प्राथमिक विद्यालय ' else 'प्राथमिक विद्यालय ' end
          || villages_hi[school_number],
        villages_en[school_number]
      )
      returning id into new_school;

      for class_grade in 1 .. 3 loop
        insert into public.class_sections (school_id, academic_year_id, grade, section, medium)
        values (new_school, year.id, class_grade, 'A', class_medium)
        returning id into new_class;
        insert into private.demo_places (
          class_section_id, sandbox_id, school_id, school_index, cluster_index, grade, medium
        )
        values (new_class, target_sandbox, new_school, school_number, cluster_number, class_grade, class_medium);
      end loop;
    end loop;
  end loop;

  -- The children: 16 to 28 in a class, a few more in Class 1. The seventh child of Class 2 in
  -- the first school is the visitor's own when they come as a family.
  select class_section_id into family_class
  from private.demo_places where sandbox_id = target_sandbox and school_index = 1 and grade = 2;
  select class_section_id into third_class
  from private.demo_places where sandbox_id = target_sandbox and school_index = 1 and grade = 3;

  insert into public.students (
    id, school_id, full_name, gender, date_of_birth, has_special_needs, status, admission_number
  )
  select
    child.id,
    child.school_id,
    private.demo_child_name(child.key, child.female),
    case when child.female then 'female' else 'male' end,
    make_date(
      extract(year from today_date)::integer - 5 - child.grade
        - case when private.demo_rand(child.key || ':age') < 0.35 then 1 else 0 end,
      1 + floor(private.demo_rand(child.key || ':month') * 12)::integer,
      1 + floor(private.demo_rand(child.key || ':day') * 28)::integer
    ),
    not child.family and private.demo_rand(child.key || ':needs') < 0.025,
    'active',
    extract(year from year.starts_on)::text || '/' || (child.grade * 100 + child.position)::text
  from (
    select
      case when p.class_section_id = family_class and n = 7
        then private.demo_id(target_sandbox::text || ':student:family')
        else private.demo_id(target_sandbox::text || ':student:' || p.class_section_id::text || ':' || n)
      end as id,
      p.school_id, p.grade, n as position,
      p.class_section_id::text || ':' || n as key,
      private.demo_rand(p.class_section_id::text || ':' || n || ':gender') < 0.49
        or (p.class_section_id = family_class and n = 7) as female,
      p.class_section_id = family_class and n = 7 as family
    from private.demo_places as p
    cross join lateral generate_series(
      1,
      16 + floor(private.demo_rand(p.class_section_id::text || ':size') * 13)::integer
        + case p.grade when 1 then 4 else 0 end
    ) as n
    where p.sandbox_id = target_sandbox
  ) as child;

  insert into public.enrolments (student_id, class_section_id, roll_number, enrolled_on)
  select
    st.id,
    p.class_section_id,
    split_part(st.admission_number, '/', 2)::integer % 100,
    -- A few children joined after the session began.
    case when private.demo_rand(st.id::text || ':late') < 0.06 and st.id <> private.demo_id(target_sandbox::text || ':student:family')
      then start_date + 9
      else year.starts_on
    end
  from public.students as st
  join private.demo_places as p
    on p.school_id = st.school_id
   and p.grade = split_part(st.admission_number, '/', 2)::integer / 100
  where p.sandbox_id = target_sandbox;

  insert into public.student_contacts (student_id, guardian_name, relationship)
  select st.id, private.demo_guardian_name(st.full_name, st.id::text, rel.relationship), rel.relationship
  from public.students as st
  cross join lateral (
    select case
      when private.demo_rand(st.id::text || ':relationship') < 0.62 then 'father'
      when private.demo_rand(st.id::text || ':relationship') < 0.95 then 'mother'
      else 'guardian'
    end as relationship
  ) as rel
  where st.school_id = any (array(select distinct school_id from private.demo_places where sandbox_id = target_sandbox));

  -- Consent for audio checks was taken on paper at admission; a few families said no.
  insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method, recorded_at)
  select
    st.id, 'audio_assessment',
    st.id = private.demo_id(target_sandbox::text || ':student:family')
      or private.demo_rand(st.id::text || ':consent') >= 0.04,
    c.guardian_name, 'paper_form',
    private.demo_at(year.starts_on - 12 + floor(private.demo_rand(st.id::text || ':consent-day') * 10)::integer, 660)
  from public.students as st
  join public.student_contacts as c on c.student_id = st.id
  where st.school_id = any (array(select distinct school_id from private.demo_places where sandbox_id = target_sandbox));

  -- One child of Class 3 moved with the family to another town three weeks ago.
  update public.students
  set status = 'left', left_on = today_date - 18, left_reason = 'transferred'
  where id = private.demo_id(target_sandbox::text || ':student:' || third_class::text || ':5');

  update private.demo_sandboxes
  set district_id = new_district, built_on = today_date, history_from = start_date
  where id = target_sandbox;

  return private.demo_people_needed(target_sandbox);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------------------------

-- Records the accounts the function created and posts everyone to their classes:
-- `{"accounts": {"teacher": {"id", "email"}, ...}, "staff": {"teacher-01": "<id>", ...}}`.
create function private.demo_build_people(target_sandbox uuid, details jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  posted_on date;
  account record;
  visitor_teacher uuid;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  posted_on := (sandbox.history_from - interval '27 months')::date;
  perform set_config('agla.demo_today', sandbox.history_from::text, true);

  insert into private.demo_people (slot, user_id)
  select entry.key, (entry.value #>> '{}')::uuid
  from jsonb_each(coalesce(details -> 'staff', '{}'::jsonb)) as entry
  on conflict (slot) do nothing;

  for account in
    select entry.key as role, (entry.value ->> 'id')::uuid as user_id, entry.value ->> 'email' as email
    from jsonb_each(coalesce(details -> 'accounts', '{}'::jsonb)) as entry
  loop
    insert into private.demo_accounts (user_id, sandbox_id, role, email)
    values (account.user_id, target_sandbox, account.role, account.email)
    on conflict (user_id) do nothing;
  end loop;

  if (select count(*) from private.demo_accounts where sandbox_id = target_sandbox) <> 4 then
    raise exception 'The district needs all four of its accounts.' using errcode = '22023';
  end if;
  select user_id into visitor_teacher
  from private.demo_accounts where sandbox_id = target_sandbox and role = 'teacher';

  -- The background staff, posted to this district's schools (a newly created one already is).
  insert into public.staff_assignments (user_id, role, school_id, cluster_id, starts_on)
  select people.user_id, needed.role::public.staff_role, needed.school_id, needed.cluster_id, posted_on
  from (
    select slot.slot, 'teacher' as role, p.school_id, null::uuid as cluster_id
    from private.demo_places as p
    cross join lateral unnest(private.demo_school_slots(p.school_index)) as slot (slot)
    where p.sandbox_id = target_sandbox and p.grade = 1
    union all
    select 'crp-01', 'crp', null, s.cluster_id
    from private.demo_places as p
    join public.schools as s on s.id = p.school_id
    where p.sandbox_id = target_sandbox and p.cluster_index = 2 and p.school_index = 9 and p.grade = 1
  ) as needed
  join private.demo_people as people on people.slot = needed.slot
  where not exists (
    select 1 from public.staff_assignments as a
    where a.user_id = people.user_id
      and a.role = needed.role::public.staff_role
      and a.ends_on is null
      and coalesce(a.school_id, a.cluster_id) = coalesce(needed.school_id, needed.cluster_id)
  );

  -- Class teachers: in the first school the visitor teaches Classes 2 and 3; elsewhere one teacher
  -- has Class 1 and the other Classes 2 and 3.
  insert into public.class_teachers (class_section_id, teacher_id, is_primary)
  select p.class_section_id,
    case
      when p.school_index = 1 and p.grade = 1 then (select user_id from private.demo_people where slot = 'teacher-01')
      when p.school_index = 1 then visitor_teacher
      else (
        select user_id from private.demo_people
        where slot = (private.demo_school_slots(p.school_index))[case when p.grade = 1 then 1 else 2 end]
      )
    end,
    true
  from private.demo_places as p
  where p.sandbox_id = target_sandbox;

  -- Two children the visitor teacher added this week, waiting for the CRP to verify them.
  perform set_config('agla.demo_today', sandbox.built_on::text, true);
  insert into public.students (id, school_id, full_name, gender, status, created_by, created_at)
  select
    private.demo_id(target_sandbox::text || ':student:pending:' || n),
    p.school_id,
    (array['Lakshmi Prajapati', 'Shubham Rajbhar'])[n],
    (array['female', 'male'])[n],
    'pending',
    visitor_teacher,
    private.demo_at(sandbox.built_on - 3, 700 + n * 7)
  from private.demo_places as p
  cross join generate_series(1, 2) as n
  where p.sandbox_id = target_sandbox and p.school_index = 1 and p.grade = 2;
  insert into public.enrolments (student_id, class_section_id, enrolled_on, created_by)
  select private.demo_id(target_sandbox::text || ':student:pending:' || n), p.class_section_id,
    sandbox.built_on - 3, visitor_teacher
  from private.demo_places as p
  cross join generate_series(1, 2) as n
  where p.sandbox_id = target_sandbox and p.school_index = 1 and p.grade = 2;

  return jsonb_build_object('posted', true);
end;
$$;

-- The account through which the visitor signs in as `role`, and the person of each role.
create function private.demo_account_of(target_sandbox uuid, role text)
returns text
language sql
stable
set search_path = ''
as $$
  select a.email from private.demo_accounts as a
  where a.sandbox_id = target_sandbox and a.role = demo_account_of.role
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. History
-- ---------------------------------------------------------------------------------------------

-- The class teacher of a class.
create function private.demo_class_teacher(target_class uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select ct.teacher_id from public.class_teachers as ct
  where ct.class_section_id = target_class and ct.is_primary
  limit 1
$$;

-- The CRP of the cluster (1 or 2) of a district.
create function private.demo_crp(target_sandbox uuid, cluster_index integer)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case cluster_index
    when 1 then (select user_id from private.demo_accounts where sandbox_id = target_sandbox and role = 'crp')
    else (select user_id from private.demo_people where slot = 'crp-01')
  end
$$;

-- Attendance of the first cluster's classes on every school day until yesterday, marked each
-- morning by the class teacher. Today's register is left for the visitor.
create function private.demo_build_attendance(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  day date;
  written integer := 0;
  added integer;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  for day in select d from private.demo_school_days(sandbox.history_from, sandbox.built_on - 1) as d loop
    perform set_config('agla.demo_today', day::text, true);
    insert into public.attendance_sessions (
      class_section_id, attendance_date, absent_student_ids, marked_by, created_at, updated_at
    )
    select
      p.class_section_id,
      day,
      coalesce(
        array_agg(e.student_id) filter (where private.demo_absent(e.student_id, p.class_section_id, day)),
        '{}'
      ),
      private.demo_class_teacher(p.class_section_id),
      private.demo_at(day, 515 + 40 * private.demo_rand(p.class_section_id::text || day::text || ':marked')),
      private.demo_at(day, 515 + 40 * private.demo_rand(p.class_section_id::text || day::text || ':marked'))
    from private.demo_places as p
    join public.enrolments as e
      on e.class_section_id = p.class_section_id
     and e.enrolled_on <= day
     and (e.ended_on is null or e.ended_on >= day)
    where p.sandbox_id = target_sandbox
      and p.cluster_index = 1
      -- Now and then a register is not filled in on the day.
      and private.demo_rand(p.class_section_id::text || day::text || ':missed') >= 0.02
    group by p.class_section_id;
    get diagnostics added = row_count;
    written := written + added;
  end loop;
  return jsonb_build_object('registers', written);
end;
$$;

-- The Pulse of every month: the real draw on the first of the month, then each drawn child's
-- check on a day of their week when they were in school, scored by the engine, and listened to
-- by the CRP where the engine was unsure or disagreed with the teacher.
create function private.demo_build_pulse(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  month_start date;
  first_month date;
  target record;
  checks integer;
  passage_words constant integer[] := array[24, 41, 57];
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  first_month := date_trunc('month', sandbox.history_from)::date;

  for month_start in
    select m::date
    from generate_series(first_month, date_trunc('month', sandbox.built_on)::date, interval '1 month') as m
    where extract(month from m) <> 6
  loop
    perform set_config('agla.demo_today', greatest(month_start, sandbox.history_from)::text, true);
    for target in
      select class_section_id from private.demo_places where sandbox_id = target_sandbox order by school_index, grade
    loop
      perform private.draw_pulse_cycle(target.class_section_id, greatest(month_start, sandbox.history_from));
    end loop;
  end loop;
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

-- Words a CRP writes. Each list is chosen from by the visit, so the same visit always reads the
-- same.
create function private.demo_strength(key text, child text, count integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(private.demo_pick(array[
    'आपने कहानी पढ़ने से पहले चित्र पर बात करवाई, जिससे {child} जैसे चुप रहने वाले बच्चे भी बोले।',
    'आपने हर पंक्ति पहले खुद पढ़ी और बच्चों ने उसे दोहराया; पिछली बेंच के बच्चे भी साथ पढ़ रहे थे।',
    'गलत उत्तर पर आपने डाँटा नहीं, संकेत दिया, और {child} खुद सही शब्द तक पहुँचा।',
    'आपने बोर्ड के शब्दों को ध्वनियों में तोड़कर पढ़वाया और बच्चों ने उन्हें जोड़कर शब्द बनाए।',
    'प्रश्न पूछकर आप कुछ पल रुके; इससे {count} बच्चों ने हाथ उठाए, सिर्फ़ आगे वालों ने नहीं।',
    'जोड़ी में पढ़ते समय हर बच्चे के हाथ में किताब थी और {count} बच्चों ने अकेले पढ़ा।',
    'आपने "This is a ..." जैसा वाक्य-ढाँचा दिया और {child} ने खुद पूरा वाक्य बोला।',
    'आपने नए शब्द का अर्थ पहले बच्चों की बोली में पूछा, फिर उसे किताब के शब्द से जोड़ा।',
    'पाठ के अंत में आपने स्लेट पर एक शब्द लिखवाकर देखा कि किसे समझ आया।'
  ], key), '{child}', child), '{count}', count::text)
$$;

-- What the teacher agrees to change, for each practice of the library.
create function private.demo_change(practice text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case practice
    when 'paired-reading' then 'पढ़ते समय बच्चों को जोड़ी में बिठाइए, ताकि हर बच्चा रोज़ कम से कम एक बार ज़ोर से पढ़े।'
    when 'small-group-rotation' then 'पढ़ने के समय कक्षा को स्तर के अनुसार तीन छोटे समूहों में बाँटिए और हर समूह के साथ 10 मिनट बैठिए।'
    when 'echo-reading' then 'नई पंक्ति पहले आप पढ़ें, फिर बच्चे दोहराएँ; उसके बाद दो-तीन बच्चे अकेले पढ़ें।'
    when 'sound-blending' then 'अक्षर लिखवाने से पहले रोज़ पाँच मिनट ध्वनियाँ जोड़कर शब्द बनाने का खेल कराइए।'
    when 'letter-sound-games' then 'अक्षर-ध्वनि कार्ड से खेल कराइए: आप ध्वनि बोलें और बच्चे सही कार्ड उठाएँ।'
    when 'read-aloud-think-aloud' then 'कहानी पढ़ते हुए बीच-बीच में रुककर ज़ोर से सोचिए: "अब आगे क्या होगा?"'
    when 'open-questions' then '"क्या" के साथ "क्यों" और "कैसे" वाले प्रश्न भी पूछिए, जिनके एक से ज़्यादा उत्तर हों।'
    when 'wait-and-prompt' then 'प्रश्न पूछकर पाँच तक गिनिए, फिर उत्तर लीजिए; गलती पर उत्तर नहीं, संकेत दीजिए।'
    when 'shared-writing' then 'बच्चों से वाक्य बुलवाकर बोर्ड पर लिखिए, फिर सब मिलकर उन्हें पढ़ें।'
    when 'picture-talk' then 'किताब के चित्र पर दो मिनट अंग्रेज़ी में बात कराइए: "What do you see?"'
    when 'sentence-frames' then 'बोर्ड पर वाक्य-ढाँचा लिखिए, जैसे "I can see a ___", और हर बच्चे से एक वाक्य बुलवाइए।'
    when 'home-language-bridge' then 'नया शब्द पहले बच्चों की बोली में पूछिए, फिर उसे हिंदी या अंग्रेज़ी शब्द से जोड़िए।'
    when 'reading-corner' then 'कक्षा के एक कोने में चित्र वाली किताबें रखिए; बच्चे रोज़ 10 मिनट खुद चुनकर पढ़ें।'
    when 'word-wall' then 'हर हफ़्ते के नए शब्द दीवार पर लगाइए और रोज़ उन्हें पढ़वाइए।'
    else 'पाठ के अंत में तीन बच्चों से छोटा प्रश्न पूछकर देखिए कि बात समझ आई या नहीं।'
  end
$$;

-- The first practice of the library for a focus item.
create function private.demo_practice_for(item_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case item_code
    when 'every-child-reads' then 'paired-reading'
    when 'sounds-before-letters' then 'sound-blending'
    when 'reads-for-meaning' then 'open-questions'
    when 'teacher-models-reading' then 'echo-reading'
    when 'todays-textbook-page' then 'echo-reading'
    when 'children-write' then 'shared-writing'
    when 'english-own-sentences' then 'sentence-frames'
    when 'english-picture-talk' then 'picture-talk'
    when 'home-language-bridge' then 'home-language-bridge'
    when 'bottom-group-turns' then 'small-group-rotation'
    when 'mistakes-handled-kindly' then 'wait-and-prompt'
    when 'thinking-time' then 'wait-and-prompt'
    when 'children-talk-more' then 'paired-reading'
    when 'book-in-every-hand' then 'reading-corner'
    when 'walls-in-use' then 'word-wall'
    else 'exit-check'
  end
$$;

-- Visits of both CRPs on their visiting days, follow-ups when a step was agreed, feedback agreed
-- after each lesson and scored by Sahayak, and the visitor CRP's tasks, plan and rehearsals. The
-- visitor CRP grows over the months: feedback sooner, more evidence, more demonstrations, and more
-- teachers found using the agreed step.
create function private.demo_build_coaching(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  first_month date;
  crp_number integer;
  crp_id uuid;
  visit_days integer[];
  day date;
  month_index integer;
  chosen record;
  visit_id uuid;
  key text;
  started timestamptz;
  lesson_seconds integer;
  moment_count integer;
  moment_number integer;
  moment_id uuid;
  moment_seconds integer;
  last_moment integer;
  agreed timestamptz;
  items text[];
  item_code text;
  item_number integer;
  answer text;
  first_no text;
  yes_chance double precision;
  practice text;
  strength_text text;
  child_name text;
  evidence text[];
  evidence_json jsonb;
  demo_given boolean;
  plan_note text;
  check_back date;
  result text;
  follows uuid;
  scored boolean;
  part_specific integer;
  part_evidence integer;
  part_focus integer;
  part_demo integer;
  part_check integer;
  part_respect integer;
  lowest text;
  visits_written integer := 0;
  focus_codes constant text[] := array[
    'sounds-before-letters', 'reads-for-meaning', 'teacher-models-reading', 'todays-textbook-page',
    'children-write', 'english-own-sentences', 'english-picture-talk', 'home-language-bridge',
    'bottom-group-turns', 'mistakes-handled-kindly', 'thinking-time', 'children-talk-more',
    'book-in-every-hand', 'walls-in-use', 'checks-understanding'
  ];
  strength_tags constant text[] := array['good-question', 'all-reading', 'child-helps-child', 'effort-praised', 'english-sentence', 'home-language-used'];
  concern_tags constant text[] := array['group-left-out', 'long-teacher-talk', 'chorus-only', 'off-task', 'harsh-correction', 'copying-only'];
  first_cluster uuid;
  open_request uuid;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  first_month := date_trunc('month', sandbox.history_from)::date;

  drop table if exists demo_visit_state;
  create temporary table demo_visit_state on commit drop as
  select p.class_section_id, p.school_id, p.school_index, p.cluster_index, p.grade, p.medium,
    null::uuid as last_visit, null::date as last_visit_on, null::date as check_back_on, 0 as visits,
    p.grade + private.demo_rand(p.class_section_id::text || ':order') as priority
  from private.demo_places as p
  where p.sandbox_id = target_sandbox;

  -- Requests teachers sent; a later visit to the class answers each.
  insert into public.visit_requests (id, class_section_id, school_id, requested_by, topic, note, created_at)
  select private.demo_id(target_sandbox::text || ':request:' || n), s.class_section_id, s.school_id,
    private.demo_class_teacher(s.class_section_id),
    (array['reading', 'english', 'classroom'])[n],
    (array[
      'आधे बच्चे अभी भी मात्राओं पर अटकते हैं। कृपया अगली बार पठन पर साथ बैठें।',
      'बच्चे अंग्रेज़ी में एक शब्द से आगे नहीं बोलते। कोई आसान तरीका बताइए।',
      'कक्षा में 38 बच्चे हैं और पीछे वाले ध्यान नहीं देते। समूह कैसे बनाऊँ?'
    ])[n],
    private.demo_at(sandbox.history_from + 12 + n * 17, 900)
  from generate_series(1, 3) as n
  join demo_visit_state as s on s.cluster_index = 1 and s.school_index = 2 + n and s.grade = 1 + (n % 3);

  for crp_number in 1 .. 2 loop
    crp_id := private.demo_crp(target_sandbox, crp_number);
    visit_days := case crp_number when 1 then array[2, 3, 4] else array[1, 3, 5] end;

    for day in
      select d from private.demo_school_days(sandbox.history_from + 3, sandbox.built_on - 1) as d
      where extract(isodow from d)::integer = any (visit_days)
    loop
      -- An exam week or a block meeting now and then keeps the CRP away from the classroom.
      continue when private.demo_rand(crp_id::text || day::text || ':away') < 0.12;
      perform set_config('agla.demo_today', day::text, true);
      month_index := ((extract(year from day) - extract(year from first_month)) * 12
        + extract(month from day) - extract(month from first_month))::integer;

      -- A step that is due to be checked comes first; otherwise the class seen least, Class 1 first.
      select * into chosen from demo_visit_state as s
      where s.cluster_index = crp_number and s.check_back_on is not null and s.check_back_on <= day
      order by s.check_back_on
      limit 1;
      if not found then
        select * into chosen from demo_visit_state as s
        where s.cluster_index = crp_number and (s.last_visit_on is null or s.last_visit_on < day - 20)
        order by s.visits, s.priority
        limit 1;
      end if;
      continue when not found;

      key := target_sandbox::text || ':visit:' || crp_number || ':' || day::text;
      visit_id := private.demo_id(key);
      started := private.demo_at(day, 590 + 100 * private.demo_rand(key || ':start'));
      lesson_seconds := 2100 + floor(900 * private.demo_rand(key || ':length'))::integer;
      follows := chosen.last_visit;
      result := null;
      if follows is not null and chosen.check_back_on is not null and chosen.check_back_on <= day then
        result := case
          when private.demo_rand(key || ':result') < case crp_number when 1 then 0.28 + 0.13 * month_index else 0.3 + 0.04 * month_index end then 'practised'
          when private.demo_rand(key || ':result') < case crp_number when 1 then 0.62 + 0.09 * month_index else 0.64 + 0.03 * month_index end then 'partly'
          else 'not_yet'
        end;
      else
        follows := null;
      end if;

      select split_part(st.full_name, ' ', 1) into child_name
      from public.enrolments as e
      join public.students as st on st.id = e.student_id
      where e.class_section_id = chosen.class_section_id and st.status = 'active'
      order by private.demo_rand(st.id::text || key)
      limit 1;

      yes_chance := least(0.85, case crp_number when 1 then 0.32 + 0.11 * month_index else 0.34 + 0.05 * month_index end
        + case result when 'practised' then 0.15 when 'partly' then 0.05 else 0 end);

      insert into public.visits (
        id, class_section_id, school_id, crp_id, teacher_id, status, visited_on, started_at,
        lesson_note, follows_visit_id, follow_up_result, created_at, updated_at
      )
      values (
        visit_id, chosen.class_section_id, chosen.school_id, crp_id,
        private.demo_class_teacher(chosen.class_section_id), 'done', day, started,
        private.demo_pick(
          case chosen.medium
            when 'en' then array['English: story "The Thirsty Crow", page 24', 'English: reading words with "a", page 15',
                                 'English: picture talk, page 9', 'English: rhyme and new words, page 31']
            else array['हिंदी: कहानी "प्यासा कौआ", पृष्ठ 24', 'हिंदी: मात्राएँ ा और ि, पृष्ठ 18',
                       'हिंदी: कविता "बादल", पृष्ठ 36', 'हिंदी: शब्द पढ़ना और लिखना, पृष्ठ 12',
                       'अंग्रेज़ी: चित्र पर बातचीत, पृष्ठ 9']
          end,
          key || ':lesson'
        ),
        follows, result, started, started
      );

      -- Four focus items: whether every child read, and three more.
      items := array['every-child-reads'] || array(
        select code from unnest(focus_codes) as code
        order by private.demo_rand(key || code)
        limit 3
      );
      first_no := null;
      item_number := 0;
      foreach item_code in array items loop
        item_number := item_number + 1;
        answer := case
          when private.demo_rand(key || item_code || ':seen') < 0.08 then 'not_seen'
          when private.demo_rand(key || item_code || ':answer') < yes_chance then 'yes'
          else 'no'
        end;
        if answer = 'no' and first_no is null then
          first_no := item_code;
        end if;
        insert into public.visit_observations (visit_id, item_code, position, answer)
        values (visit_id, item_code, item_number, answer);
      end loop;

      -- Moments tapped while the lesson went on.
      moment_count := 4 + floor(4 * private.demo_rand(key || ':moments'))::integer;
      evidence := '{}';
      last_moment := 0;
      for moment_number in 1 .. moment_count loop
        moment_id := private.demo_id(key || ':moment:' || moment_number);
        moment_seconds := least(
          lesson_seconds,
          120 + (moment_number - 1) * (lesson_seconds - 240) / moment_count
            + floor(90 * private.demo_rand(key || ':at' || moment_number))::integer
        );
        last_moment := greatest(last_moment, moment_seconds);
        if private.demo_rand(key || ':tone' || moment_number) < yes_chance + 0.1 then
          insert into public.visit_moments (id, visit_id, tag_code, at_seconds, note)
          values (
            moment_id, visit_id,
            private.demo_pick(strength_tags, key || ':tag' || moment_number),
            moment_seconds,
            case when private.demo_rand(key || ':note' || moment_number) < 0.35 then
              replace(private.demo_pick(array[
                '{child} ने बिना रुके पूरी पंक्ति पढ़ी।',
                '{child} ने साथी को शब्द पढ़ने में मदद की।',
                '{child} ने अंग्रेज़ी में पूरा वाक्य बोला।',
                'पीछे की बेंच से {child} ने पहली बार उत्तर दिया।'
              ], key || ':notetext' || moment_number), '{child}', child_name)
            end
          );
          if cardinality(evidence) < (case when private.demo_rand(key || ':evidence') < 0.35 + 0.2 * month_index then 2 else 1 end)
             and (crp_number = 2 or month_index > 0 or private.demo_rand(key || ':cite') < 0.5)
          then
            evidence := evidence || ('moment:' || moment_id::text);
          end if;
        else
          insert into public.visit_moments (id, visit_id, tag_code, at_seconds, note)
          values (
            moment_id, visit_id,
            private.demo_pick(concern_tags, key || ':tag' || moment_number),
            moment_seconds,
            case when private.demo_rand(key || ':note' || moment_number) < 0.3 then
              private.demo_pick(array[
                'पीछे बैठे पाँच बच्चे किताब नहीं खोल रहे थे।',
                'पढ़ना केवल सामूहिक रूप से हुआ, किसी बच्चे ने अकेले नहीं पढ़ा।',
                'शिक्षक लगभग आठ मिनट लगातार बोलते रहे।',
                'बोर्ड से नकल में आधा समय गया।'
              ], key || ':notetext' || moment_number)
            end
          );
        end if;
      end loop;

      practice := private.demo_practice_for(coalesce(first_no, items[1]));
      if first_no is not null and private.demo_rand(key || ':cite-item') < 0.5 then
        evidence := evidence || ('item:' || first_no);
      end if;
      strength_text := private.demo_strength(key || ':strength', child_name, 6 + floor(14 * private.demo_rand(key || ':count'))::integer);
      demo_given := private.demo_rand(key || ':demo') < case crp_number when 1 then 0.3 + 0.17 * month_index else 0.35 end;
      plan_note := private.demo_pick(array[
        'अगले दो हफ़्ते रोज़ हिंदी के पीरियड में 10 मिनट यही अभ्यास। अगली विज़िट में तीन बच्चों को साथ सुनेंगे।',
        'कल से शुरू करेंगे; हर शुक्रवार को देखेंगे कि कितने बच्चों ने अकेले पढ़ा।',
        'पहले हफ़्ते केवल एक समूह के साथ, दूसरे हफ़्ते पूरी कक्षा के साथ।'
      ], key || ':plan');
      check_back := day + 14 + floor(5 * private.demo_rand(key || ':back'))::integer;
      agreed := least(
        now() - interval '30 minutes',
        started + make_interval(secs => last_moment)
          + make_interval(secs => 60 * greatest(
              4,
              case crp_number when 1 then 48 - 11 * month_index else 58 - 4 * month_index end
                + (private.demo_rand(key || ':delay') - 0.5) * 16
            ))
      );
      select coalesce(jsonb_agg(
          case when entry like 'moment:%'
            then jsonb_build_object('moment', substr(entry, 8))
            else jsonb_build_object('item', substr(entry, 6))
          end
        ), '[]'::jsonb)
      into evidence_json
      from unnest(evidence) as entry;

      insert into public.visit_feedback (
        visit_id, strength, evidence, practice_code, change_note, demo_given, plan_note,
        check_back_on, language, agreed_at
      )
      values (
        visit_id, strength_text, evidence_json, practice, private.demo_change(practice), demo_given,
        plan_note, check_back, 'hi', agreed
      );

      -- The CRP ended the visit a few minutes after agreeing the step.
      update public.visits
      set finished_at = least(started + interval '11 hours', agreed + interval '6 minutes'),
          done_at = least(now(), agreed + interval '6 minutes')
      where id = visit_id;

      -- Sahayak's score of the feedback, on the same six parts as always.
      scored := private.demo_rand(key || ':scored') < case crp_number when 1 then 0.85 else 0.7 end;
      if scored then
        part_specific := case
          when (strength_text like '%' || child_name || '%' or strength_text ~ '[0-9]')
               and private.demo_rand(key || ':specific') < case crp_number when 1 then 0.5 + 0.17 * month_index else 0.6 end
          then 2 else 1 end;
        part_evidence := least(2, cardinality(evidence));
        part_focus := case when private.demo_rand(key || ':focus') < case crp_number when 1 then 0.4 - 0.11 * month_index else 0.3 end then 1 else 2 end;
        part_demo := case when demo_given then 2 when private.demo_rand(key || ':shown') < 0.5 then 1 else 0 end;
        part_check := case when private.demo_rand(key || ':checkback') < case crp_number when 1 then 0.4 - 0.12 * month_index else 0.3 end then 1 else 2 end;
        part_respect := case when private.demo_rand(key || ':respect') < case crp_number when 1 then 0.16 - 0.05 * month_index else 0.12 end then 1 else 2 end;
        lowest := case least(part_specific, part_evidence, part_focus, part_demo, part_check, part_respect)
          when part_evidence then 'evidence'
          when part_demo then 'demonstration'
          when part_specific then 'specific'
          when part_focus then 'focus'
          when part_check then 'check'
          else 'respect'
        end;
        insert into public.visit_feedback_scores (
          visit_id, crp_id, specific, evidence, one_focus, demonstration, check_back, respectful,
          tip, language, model, feedback_agreed_at, feedback_fingerprint, scored_at
        )
        values (
          visit_id, crp_id, part_specific, part_evidence, part_focus, part_demo, part_check, part_respect,
          case lowest
            when 'evidence' then 'अगली बार ताकत के साथ वह पल भी बताइए जिसमें यह दिखा, जैसे किस बच्चे ने क्या पढ़ा।'
            when 'demonstration' then 'सुझाव को दो मिनट खुद करके दिखाइए; देखकर अपनाना आसान होता है।'
            when 'specific' then 'ताकत को किसी देखी हुई बात से जोड़िए: किसने, कब, क्या किया।'
            when 'focus' then 'एक ही बदलाव चुनिए; कई सुझाव एक साथ देने से शिक्षक किसी पर टिक नहीं पाते।'
            when 'check' then 'वापस देखने की तारीख शिक्षक के साथ तय कीजिए और लिख लीजिए।'
            else 'बात किसी अच्छी चीज़ से शुरू कीजिए जो आपने खुद देखी; इससे बातचीत सहज रहती है।'
          end,
          'hi', 'openai/gpt-oss-120b', agreed,
          private.demo_fingerprint(strength_text, evidence, practice, private.demo_change(practice), null, demo_given, plan_note, check_back),
          least(now(), agreed + make_interval(mins => 2 + floor(25 * private.demo_rand(key || ':scored-at'))::integer))
        );
      end if;

      -- In recent weeks the CRP re-checked one or two children the class had recorded.
      if day >= sandbox.built_on - 50 then
        insert into public.visit_rechecks (visit_id, check_id, reading_level, english_level)
        select visit_id, k.id, truth.reading, truth.english
        from public.pulse_checks as k
        join public.pulse_samples as s on s.id = k.sample_id
        join public.pulse_cycles as c on c.id = s.cycle_id
        cross join lateral private.demo_child(
          k.student_id, chosen.school_id, chosen.grade,
          ((extract(year from c.month) - extract(year from first_month)) * 12
            + extract(month from c.month) - extract(month from first_month))::integer,
          crp_number = 1
        ) as truth
        where k.class_section_id = chosen.class_section_id
          and k.mode = 'recorded'
          and (k.recorded_at at time zone 'Asia/Kolkata')::date between day - 30 and day
        order by private.demo_rand(k.id::text || key)
        limit case when private.demo_rand(key || ':rechecks') < 0.5 then 1 else 2 end;
      end if;

      update demo_visit_state
      set last_visit = visit_id, last_visit_on = day, check_back_on = check_back, visits = visits + 1
      where class_section_id = chosen.class_section_id;
      visits_written := visits_written + 1;
    end loop;
  end loop;

  -- What the visitor CRP sees today: an open request, the next visits planned, tasks, rehearsals.
  perform set_config('agla.demo_today', sandbox.built_on::text, true);
  open_request := private.demo_id(target_sandbox::text || ':request:open');
  insert into public.visit_requests (id, class_section_id, school_id, requested_by, topic, note, created_at)
  select open_request, s.class_section_id, s.school_id, private.demo_class_teacher(s.class_section_id),
    'reading', 'कक्षा 1 के छह बच्चे अभी अक्षर पहचान पर अटके हैं। कृपया अगली बार उनके साथ बैठें।',
    least(now() - interval '2 hours', private.demo_at(sandbox.built_on - 2, 940))
  from demo_visit_state as s
  where s.cluster_index = 1 and s.school_index = 1 and s.grade = 1;

  insert into public.visits (
    id, class_section_id, school_id, crp_id, teacher_id, status, planned_on, follows_visit_id,
    request_id, created_at, updated_at
  )
  select
    private.demo_id(target_sandbox::text || ':planned:' || planned.day_position),
    planned.class_section_id, planned.school_id, private.demo_crp(target_sandbox, 1),
    private.demo_class_teacher(planned.class_section_id), 'planned', planned.on_day,
    null,
    case when planned.school_index = 1 and planned.grade = 1 then open_request end,
    now() - interval '1 day', now() - interval '1 day'
  from (
    select s.*, d.on_day, d.position as day_position
    from (
      select row_number() over (order by (s.school_index = 1 and s.grade = 1) desc, s.check_back_on nulls last, s.visits, s.priority) as position, s.*
      from demo_visit_state as s
      where s.cluster_index = 1
    ) as s
    join (
      select next_day.on_day, row_number() over (order by next_day.on_day) as position
      from private.demo_school_days(sandbox.built_on, sandbox.built_on + 10) as next_day (on_day)
      where extract(isodow from next_day.on_day)::integer in (2, 3, 4)
      limit 3
    ) as d on d.position = s.position
  ) as planned;

  select c.cluster_id into first_cluster from public.schools as c
  join private.demo_places as p on p.school_id = c.id
  where p.sandbox_id = target_sandbox and p.cluster_index = 1 limit 1;

  insert into public.crp_tasks (id, cluster_id, school_id, created_by, title, details, source, due_on, done_at, created_at, updated_at)
  values
    (private.demo_id(target_sandbox::text || ':task:1'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'BRC को निपुण आकलन का कक्षावार सारांश भेजना', 'खंड शिक्षा अधिकारी के आदेश के अनुसार, सभी आठ विद्यालयों का।', 'order',
     sandbox.built_on + 5, null, now() - interval '6 days', now() - interval '6 days'),
    (private.demo_id(target_sandbox::text || ':task:2'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'संकुल बैठक: ध्वनि-खेल पर दो नमूना पाठ तैयार करना', null, 'meeting',
     sandbox.built_on + 9, null, now() - interval '3 days', now() - interval '3 days'),
    (private.demo_id(target_sandbox::text || ':task:3'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'विद्यालयों में पुस्तकालय की नई किताबें बाँटना', null, 'circular',
     sandbox.built_on - 6, now() - interval '8 days', now() - interval '20 days', now() - interval '8 days'),
    (private.demo_id(target_sandbox::text || ':task:4'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'कक्षा 1 के शिक्षकों के साथ अक्षर-ध्वनि कार्ड का प्रदर्शन', null, 'own',
     sandbox.built_on + 12, null, now() - interval '1 day', now() - interval '1 day');

  insert into public.rehearsal_debriefs (
    crp_id, scenario, language, turns, named_practice, asked_constraints, agreed_check_back,
    kept_blame_out, cited_evidence, went_well, try_next, provider, created_at
  )
  select
    private.demo_crp(target_sandbox, 1),
    (array['tired-veteran', 'pulse-defensive', 'eager-new-teacher', 'overloaded-head-teacher', 'tired-veteran'])[n],
    'hi',
    6 + n * 2,
    n >= 2, n >= 3, n >= 2, n <> 2, n >= 4,
    (array[
      'आपने बातचीत अच्छे माहौल में शुरू की और शिक्षक की बात ध्यान से सुनी।',
      'आपने एक ही अभ्यास पर बात टिकाए रखी और उसे नाम से बताया।',
      'आपने शिक्षक की कठिनाइयाँ पूछीं और उनके हिसाब से कदम छोटा किया।',
      'आपने वापस देखने की तारीख तय की और देखे हुए पल का हवाला दिया।',
      'पूरी बातचीत में दोष नहीं दिया, सबूत दिया, और अगला कदम साफ़ रहा।'
    ])[n],
    (array[
      'अगली बार बताइए कि आपने कक्षा में क्या देखा, और एक ही बदलाव चुनिए।',
      'शिक्षक के बचाव पर बहस नहीं, Pulse के आँकड़े साथ में देखिए।',
      'उत्साह के साथ छोटा, पहला कदम तय कीजिए जो कल से हो सके।',
      'समय की कमी मानिए और अभ्यास को मौजूदा पीरियड में ही जोड़िए।',
      'यही ढाँचा असली विज़िट में भी अपनाइए।'
    ])[n],
    'groq',
    least(now() - interval '1 day', private.demo_at(sandbox.history_from + 20 + n * 18, 1170))
  from generate_series(1, 5) as n
  where sandbox.history_from + 20 + n * 18 < sandbox.built_on;

  return jsonb_build_object('visits', visits_written);
end;
$$;

-- The cluster's monthly assessments of the finished months, marked by the class teachers and
-- shared with families, and this month's class test of the visitor teacher, half marked.
create function private.demo_build_exams(target_sandbox uuid)
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

    insert into public.exams (id, academic_year_id, kind, title, cluster_id, starts_on, ends_on, created_by, created_at, updated_at)
    values (
      this_exam, year_id, 'unit_test',
      'मासिक आकलन – ' || month_names[extract(month from month_start)::integer],
      first_cluster, starts, starts + 4, private.demo_crp(target_sandbox, 1),
      private.demo_at(starts - 6, 690), private.demo_at(starts - 6, 690)
    );

    insert into public.exam_papers (id, exam_id, class_section_id, school_id, subject, held_on, scale, max_marks, created_at, updated_at)
    select private.demo_id(this_exam::text || p.class_section_id::text || subject.name), this_exam,
      p.class_section_id, p.school_id, subject.name, starts + subject.position - 1, 'marks', 20,
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
    insert into public.exams (id, academic_year_id, kind, title, school_id, starts_on, ends_on, created_by, created_at, updated_at)
    select this_exam, year_id, 'class_test',
      'कक्षा परीक्षा – ' || month_names[extract(month from sandbox.built_on)::integer],
      p.school_id, starts, sandbox.built_on, visitor_teacher, private.demo_at(starts - 1, 900), private.demo_at(starts - 1, 900)
    from private.demo_places as p
    where p.sandbox_id = target_sandbox and p.school_index = 1 and p.grade = 2;

    insert into public.exam_papers (id, exam_id, class_section_id, school_id, subject, held_on, scale, max_marks, created_at, updated_at)
    select private.demo_id(this_exam::text || p.class_section_id::text || subject.name), this_exam,
      p.class_section_id, p.school_id, subject.name,
      least(sandbox.built_on, starts + subject.position - 1), 'marks', 25,
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

-- Notes the first school's teachers sent home over the last five weeks.
create function private.demo_build_notes(target_sandbox uuid)
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
    case when note.kind = 'homework' then note.day + 2 end,
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

-- ---------------------------------------------------------------------------------------------
-- 4. Sample recordings and readiness
-- ---------------------------------------------------------------------------------------------

-- Places each sample recording as this week's check of a drawn child in a class the visitor CRP
-- will visit, with the engine's real score of that recording, so that the CRP has recordings to
-- listen to; returns where each file goes. `recordings` is a list of
-- `{"key", "type", "grade", "item_code", "prompt_code", "duration_ms", "bytes",
--   "teacher_reading", "teacher_english", "shown", "score": {pulse_scores columns}}`.
create function private.demo_build_finish(target_sandbox uuid, details jsonb)
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
    select s.id as sample_id, s.class_section_id, s.student_id, s.opens_on into target
    from public.pulse_samples as s
    join public.pulse_cycles as c on c.id = s.cycle_id
    join private.demo_places as p on p.class_section_id = s.class_section_id
    left join public.visits as v
      on v.class_section_id = s.class_section_id and v.status = 'planned'
    where p.sandbox_id = target_sandbox
      and p.cluster_index = 1 and p.medium = 'hi'
      and p.grade = (recording ->> 'grade')::integer
      and c.month = date_trunc('month', sandbox.built_on)::date
      and s.week is not null and s.opens_on <= sandbox.built_on and not s.adapted
      and not exists (select 1 from public.pulse_checks as k where k.sample_id = s.id)
      and not (s.id = any (taken))
    order by (v.id is null), private.demo_rand(s.id::text || (recording ->> 'key'))
    limit 1;
    continue when not found;
    taken := taken || target.sample_id;
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

-- Builds one step of a demonstration district (see the top of this file).
create function private.demo_build(target_sandbox uuid, phase text, details jsonb)
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

-- ---------------------------------------------------------------------------------------------
-- The visitor's district
-- ---------------------------------------------------------------------------------------------

-- The caller's demonstration district: their role in it, when it ends, and the person and place of
-- each role; null for every real account.
create function private.demo_of_caller()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', mine.role,
    'expires_at', sandbox.expires_at,
    'school', (
      select s.name_en from private.demo_places as p join public.schools as s on s.id = p.school_id
      where p.sandbox_id = sandbox.id and p.school_index = 1 limit 1
    ),
    'school_hi', (
      select s.name_hi from private.demo_places as p join public.schools as s on s.id = p.school_id
      where p.sandbox_id = sandbox.id and p.school_index = 1 limit 1
    ),
    'people', (
      select jsonb_object_agg(a.role, p.full_name)
      from private.demo_accounts as a
      join public.profiles as p on p.id = a.user_id
      where a.sandbox_id = sandbox.id
    )
  )
  from private.demo_accounts as mine
  join private.demo_sandboxes as sandbox on sandbox.id = mine.sandbox_id
  where mine.user_id = auth.uid() and sandbox.status = 'ready'
$$;

create function public.my_demo()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.demo_of_caller()
$$;

comment on function public.my_demo() is
  'The caller''s demonstration district and role in it; null for every real account.';

-- The district of a demonstration account, for switching roles.
create function private.demo_sandbox_of(target_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.sandbox_id
  from private.demo_accounts as a
  join private.demo_sandboxes as s on s.id = a.sandbox_id
  where a.user_id = target_user_id and s.status = 'ready' and s.expires_at > now()
$$;

-- ---------------------------------------------------------------------------------------------
-- Removing expired districts
-- ---------------------------------------------------------------------------------------------

-- Districts due for removal, oldest first, with the accounts and stored files to delete first.
create function private.demo_due(batch_size integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'sandbox', s.id,
      'accounts', coalesce((
        select jsonb_agg(a.user_id) from private.demo_accounts as a where a.sandbox_id = s.id
      ), '[]'::jsonb),
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
    ) order by s.expires_at), '[]'::jsonb)
  from (
    select * from private.demo_sandboxes
    where expires_at <= now()
    order by expires_at
    limit greatest(1, least(coalesce(batch_size, 5), 20))
  ) as s
$$;

-- Ends a district now; the hourly sweep then removes it like any expired one.
create function private.demo_expire(target_sandbox uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update private.demo_sandboxes set expires_at = now() where id = target_sandbox and expires_at > now()
  returning true
$$;

-- Removes a district's data; its accounts are deleted through the Auth service afterwards.
create function private.demo_remove(target_sandbox uuid)
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
-- Service functions for the `demo` Edge Function
-- ---------------------------------------------------------------------------------------------

-- Like the other service functions, these run with the caller's rights: only the secret key's
-- role may call them.

create function public.service_demo_open(client_key text)
returns jsonb
language sql
set search_path = ''
as $$
  select private.demo_open(client_key)
$$;

create function public.service_demo_build(target_sandbox uuid, phase text, details jsonb default '{}')
returns jsonb
language sql
set search_path = ''
as $$
  select private.demo_build(target_sandbox, phase, details)
$$;

create function public.service_demo_account(target_sandbox uuid, role text)
returns text
language sql
stable
set search_path = ''
as $$
  select private.demo_account_of(target_sandbox, role)
$$;

create function public.service_demo_sandbox_of(target_user_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select private.demo_sandbox_of(target_user_id)
$$;

create function public.service_demo_due(batch_size integer default 5)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.demo_due(batch_size)
$$;

create function public.service_demo_expire(target_sandbox uuid)
returns boolean
language sql
set search_path = ''
as $$
  select coalesce(private.demo_expire(target_sandbox), false)
$$;

create function public.service_demo_remove(target_sandbox uuid)
returns boolean
language sql
set search_path = ''
as $$
  select private.demo_remove(target_sandbox)
$$;

-- ---------------------------------------------------------------------------------------------
-- Job token and schedule
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'Vault is not available; the demonstration job token was not created.';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'demo_job_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'demo_job_token',
      'Sent by the hourly job to the demo Edge Function to remove expired demonstration districts.'
    );
  end if;
end;
$$;

-- Asks the Edge Function to remove expired districts. Does nothing (with a notice) until the
-- project URL is in Vault and the network extension is installed.
create function private.request_demo_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  token text := private.job_token('demo');
begin
  if not exists (select 1 from private.demo_sandboxes where expires_at <= now()) then
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

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on function private.demo_work() from public;
revoke all on function private.demo_school_ids() from public;
revoke all on function private.demo_district_ids() from public;
revoke all on function private.demo_user_ids() from public;
revoke all on function private.demo_rand(text) from public;
revoke all on function private.demo_pick(text[], text) from public;
revoke all on function private.demo_id(text) from public;
revoke all on function private.demo_school_days(date, date) from public;
revoke all on function private.demo_absent(uuid, uuid, date) from public;
revoke all on function private.demo_at(date, double precision) from public;
revoke all on function private.demo_child(uuid, uuid, integer, integer, boolean) from public;
revoke all on function private.demo_level_step(text, boolean) from public;
revoke all on function private.demo_fingerprint(text, text[], text, text, text, boolean, text, date) from public;
revoke all on function private.demo_child_name(text, boolean) from public;
revoke all on function private.demo_guardian_name(text, text, text) from public;
revoke all on function private.demo_staff_name(text) from public;
revoke all on function private.demo_school_slots(integer) from public;
revoke all on function private.demo_open(text) from public;
revoke all on function private.demo_people_needed(uuid) from public;
revoke all on function private.demo_build_places(uuid) from public;
revoke all on function private.demo_build_people(uuid, jsonb) from public;
revoke all on function private.demo_account_of(uuid, text) from public;
revoke all on function private.demo_class_teacher(uuid) from public;
revoke all on function private.demo_crp(uuid, integer) from public;
revoke all on function private.demo_build_attendance(uuid) from public;
revoke all on function private.demo_build_pulse(uuid) from public;
revoke all on function private.demo_strength(text, text, integer) from public;
revoke all on function private.demo_change(text) from public;
revoke all on function private.demo_practice_for(text) from public;
revoke all on function private.demo_build_coaching(uuid) from public;
revoke all on function private.demo_build_exams(uuid) from public;
revoke all on function private.demo_build_notes(uuid) from public;
revoke all on function private.demo_build_finish(uuid, jsonb) from public;
revoke all on function private.demo_build(uuid, text, jsonb) from public;
revoke all on function private.demo_of_caller() from public;
revoke all on function private.demo_sandbox_of(uuid) from public;
revoke all on function private.demo_due(integer) from public;
revoke all on function private.demo_remove(uuid) from public;
revoke all on function private.demo_expire(uuid) from public;
revoke all on function private.request_demo_sweep() from public;
revoke all on function public.my_demo() from public, anon;
revoke all on function public.service_demo_open(text) from public, anon, authenticated;
revoke all on function public.service_demo_build(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.service_demo_account(uuid, text) from public, anon, authenticated;
revoke all on function public.service_demo_sandbox_of(uuid) from public, anon, authenticated;
revoke all on function public.service_demo_due(integer) from public, anon, authenticated;
revoke all on function public.service_demo_remove(uuid) from public, anon, authenticated;
revoke all on function public.service_demo_expire(uuid) from public, anon, authenticated;

grant execute on function
  private.demo_work(),
  private.demo_school_ids(),
  private.demo_district_ids(),
  private.demo_user_ids(),
  private.demo_of_caller()
  to authenticated, service_role;
grant execute on function
  private.demo_open(text),
  private.demo_build(uuid, text, jsonb),
  private.demo_account_of(uuid, text),
  private.demo_sandbox_of(uuid),
  private.demo_due(integer),
  private.demo_remove(uuid),
  private.demo_expire(uuid),
  public.service_demo_open(text),
  public.service_demo_build(uuid, text, jsonb),
  public.service_demo_account(uuid, text),
  public.service_demo_sandbox_of(uuid),
  public.service_demo_due(integer),
  public.service_demo_remove(uuid),
  public.service_demo_expire(uuid)
  to service_role;
grant execute on function public.my_demo() to authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the demonstration sweep was not scheduled.';
    return;
  end if;
  perform cron.schedule('demo-sweep', '20 * * * *', 'select private.request_demo_sweep()');
end;
$$;
