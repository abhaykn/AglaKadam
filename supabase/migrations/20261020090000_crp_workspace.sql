-- The CRP workspace: the week's plan, school visits, coaching and the follow-up.
--
-- A CRP mentors the teachers of the schools in their cluster through a loop of five steps:
--   * Plan: each week the CRP's phone ranks the classes to visit from the cluster's records (see
--     `crp_class_signal`): the latest Pulse results, the time since the last visit, agreed steps due
--     for a check-back, teachers' requests for a visit, and the CRP's own tasks from orders and
--     circulars. The ranking itself is computed on the phone, so that it works without a network.
--   * Observe: during a visit the CRP answers up to five focus items (yes, no, or not seen), taps
--     moment tags as things happen, and re-checks up to two children from the class's last Pulse in
--     person. The phone keeps the visit and sends it when it can.
--   * Coach: after the lesson the CRP records one strength with its evidence, one practice to
--     change with its technique, a demonstration, a two-week plan and a check-back date, and notes
--     when the teacher agreed to the step. The agreed step is the teacher's practice card.
--   * Follow up: the next visit to the class checks the agreed step, and the next month's Pulse
--     shows whether learning moved.
--   * The CRP also listens to Pulse recordings the engine was unsure of, or where it and the
--     teacher disagreed, and records their own levels (`pulse_reviews`).
--
-- Who sees what:
--   * The CRPs of the cluster see all its visits, including those of an earlier CRP, so that the
--     history stays with the schools when a CRP is transferred. Only the CRP who made a visit
--     changes it, and only within 14 days.
--   * Teachers see the visits in which they were observed, with everything the CRP recorded about
--     them; a visit without an observed teacher is seen by the class's teachers. A colleague never
--     reads the coaching another teacher received.
--   * A visit is written only through `save_visit`, as a whole, so that two devices cannot overwrite
--     each other's changes unnoticed.
--   * Education officers see no individual visit; their reports are aggregates.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.visit_requests (
  id uuid primary key default gen_random_uuid(),
  class_section_id uuid not null references public.class_sections (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  topic text not null,
  note text,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  answered_by_visit_id uuid,
  constraint visit_requests_topic_valid check (
    topic in ('reading', 'english', 'classroom', 'other')
  ),
  constraint visit_requests_note_length check (
    note is null or char_length(btrim(note)) between 1 and 300
  ),
  constraint visit_requests_closed_once check (
    withdrawn_at is null or answered_by_visit_id is null
  )
);

comment on table public.visit_requests is
  'A teacher''s request for a visit to a class. It stays open until a visit to the class takes '
  'place or the teacher withdraws it.';

create unique index visit_requests_one_open_per_class on public.visit_requests (class_section_id)
  where withdrawn_at is null and answered_by_visit_id is null;
create index visit_requests_class_section_id_idx on public.visit_requests (class_section_id);
create index visit_requests_school_id_idx on public.visit_requests (school_id);
create index visit_requests_requested_by_idx on public.visit_requests (requested_by);

create table public.visits (
  id uuid primary key,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  crp_id uuid references public.profiles (id) on delete set null,
  teacher_id uuid references public.profiles (id) on delete set null,
  status text not null default 'planned',
  planned_on date,
  visited_on date,
  started_at timestamptz,
  finished_at timestamptz,
  done_at timestamptz,
  lesson_note text,
  follows_visit_id uuid references public.visits (id) on delete set null,
  follow_up_result text,
  request_id uuid references public.visit_requests (id) on delete set null,
  revision integer not null default 1,
  client_change_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visits_revision_positive check (revision >= 1),
  constraint visits_lesson_note_length check (
    lesson_note is null or char_length(btrim(lesson_note)) between 1 and 160
  ),
  constraint visits_status_valid check (status in ('planned', 'done')),
  constraint visits_status_shape check (
    (status = 'planned' and planned_on is not null and visited_on is null and started_at is null)
    or (status = 'done' and visited_on is not null and started_at is not null)
  ),
  constraint visits_times_valid check (
    finished_at is null
    or (finished_at >= started_at and finished_at <= started_at + interval '12 hours')
  ),
  constraint visits_follow_up_result_valid check (
    follow_up_result is null or follow_up_result in ('practised', 'partly', 'not_yet')
  ),
  constraint visits_follow_up_shape check (
    follow_up_result is null or (follows_visit_id is not null and status = 'done')
  ),
  constraint visits_not_own_follow_up check (follows_visit_id is distinct from id)
);

comment on table public.visits is
  'A CRP''s visit to a class: planned, or taken place (`done`). The child tables hold what was '
  'observed and the coaching that followed.';
comment on column public.visits.id is
  'Chosen by the device, so that a visit recorded without a network is recognised when resent.';
comment on column public.visits.teacher_id is 'The teacher whose lesson was observed.';
comment on column public.visits.visited_on is 'Date of the visit in India.';
comment on column public.visits.done_at is
  'When the server first recorded the visit as taken place. The 14 days in which it can be changed '
  'count from here or from the visit''s date, whichever is earlier.';
comment on column public.visits.lesson_note is
  'The lesson and textbook page the class was on, which the demonstration builds on.';
comment on column public.visits.follows_visit_id is
  'The earlier visit whose agreed step this visit checks.';
comment on column public.visits.revision is
  'Counts the changes to the visit, so that a device saving over a version it has not seen is '
  'refused.';
comment on column public.visits.client_change_id is
  'The device''s identifier of the save that wrote this revision, set only by `save_visit`: a '
  'device recognises its own earlier save and does not mistake it for another device''s.';
comment on column public.visits.follow_up_result is
  'Whether the teacher was practising the agreed step: practised, partly, or not yet.';

alter table public.visit_requests
  add constraint visit_requests_answered_by_visit_id_fkey
  foreign key (answered_by_visit_id) references public.visits (id) on delete set null;
create index visit_requests_answered_by_visit_id_idx on public.visit_requests (answered_by_visit_id);

create index visits_class_section_id_idx on public.visits (class_section_id, visited_on desc);
create index visits_school_id_idx on public.visits (school_id);
create index visits_crp_id_idx on public.visits (crp_id);
create index visits_teacher_id_idx on public.visits (teacher_id);
create index visits_follows_visit_id_idx on public.visits (follows_visit_id);
create index visits_request_id_idx on public.visits (request_id);

create table public.visit_observations (
  visit_id uuid not null references public.visits (id) on delete cascade,
  item_code text not null,
  position smallint not null,
  answer text,
  note text,
  primary key (visit_id, item_code),
  constraint visit_observations_visit_position_key unique (visit_id, position),
  constraint visit_observations_item_code_format check (item_code ~ '^[a-z][a-z0-9-]{2,47}$'),
  constraint visit_observations_position_range check (position between 1 and 5),
  constraint visit_observations_answer_valid check (
    answer is null or answer in ('yes', 'no', 'not_seen')
  ),
  constraint visit_observations_note_length check (
    note is null or char_length(btrim(note)) between 1 and 300
  )
);

comment on table public.visit_observations is
  'The focus items of a visit, at most five, and what the CRP saw.';

create table public.visit_moments (
  id uuid primary key,
  visit_id uuid not null references public.visits (id) on delete cascade,
  tag_code text not null,
  at_seconds integer not null,
  note text,
  constraint visit_moments_tag_code_format check (tag_code ~ '^[a-z][a-z0-9-]{2,47}$'),
  constraint visit_moments_at_seconds_range check (at_seconds between 0 and 43200),
  constraint visit_moments_note_length check (
    note is null or char_length(btrim(note)) between 1 and 200
  )
);

comment on table public.visit_moments is
  'Moments the CRP tagged during the lesson, in seconds from the start of the visit.';

create index visit_moments_visit_id_idx on public.visit_moments (visit_id, at_seconds);

create table public.visit_rechecks (
  visit_id uuid not null references public.visits (id) on delete cascade,
  check_id uuid not null references public.pulse_checks (id) on delete cascade,
  reading_level text not null,
  english_level text not null,
  note text,
  primary key (visit_id, check_id),
  constraint visit_rechecks_reading_level_valid check (
    reading_level in ('fluent', 'hesitant', 'needs_support')
  ),
  constraint visit_rechecks_english_level_valid check (
    english_level in ('sentences', 'words', 'no_response')
  ),
  constraint visit_rechecks_note_length check (
    note is null or char_length(btrim(note)) between 1 and 300
  )
);

comment on table public.visit_rechecks is
  'Children of the class''s last Pulse whom the CRP heard read in person during the visit, at most '
  'two. A large gap from the check is a reason for a conversation, not a penalty.';

create index visit_rechecks_check_id_idx on public.visit_rechecks (check_id);

create table public.visit_feedback (
  visit_id uuid primary key references public.visits (id) on delete cascade,
  strength text not null,
  evidence jsonb not null default '[]',
  practice_code text not null,
  change_note text,
  technique text,
  demo_given boolean not null default false,
  plan_note text,
  check_back_on date not null,
  language text not null default 'hi',
  agreed_at timestamptz,
  constraint visit_feedback_strength_length check (char_length(btrim(strength)) between 1 and 500),
  constraint visit_feedback_practice_code_format check (
    practice_code ~ '^[a-z][a-z0-9-]{2,47}$'
  ),
  constraint visit_feedback_change_note_length check (
    change_note is null or char_length(btrim(change_note)) between 1 and 500
  ),
  constraint visit_feedback_technique_length check (
    technique is null or char_length(btrim(technique)) between 1 and 1000
  ),
  constraint visit_feedback_plan_note_length check (
    plan_note is null or char_length(btrim(plan_note)) between 1 and 1000
  ),
  constraint visit_feedback_language_valid check (language in ('hi', 'en')),
  constraint visit_feedback_evidence_shape check (
    jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 8
  )
);

comment on table public.visit_feedback is
  'The coaching after a visit: one strength with its evidence, one practice to change, and the '
  'check-back date. `agreed_at` is when the teacher agreed to the step in person.';
comment on column public.visit_feedback.evidence is
  'What the strength rests on: moments (`{"moment": id}`) and focus items (`{"item": code}`) of '
  'the same visit.';

create table public.pulse_reviews (
  check_id uuid primary key references public.pulse_checks (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reading_level text not null,
  english_level text not null,
  note text,
  reviewed_at timestamptz not null default now(),
  constraint pulse_reviews_reading_level_valid check (
    reading_level in ('fluent', 'hesitant', 'needs_support')
  ),
  constraint pulse_reviews_english_level_valid check (
    english_level in ('sentences', 'words', 'no_response')
  ),
  constraint pulse_reviews_note_length check (
    note is null or char_length(btrim(note)) between 1 and 300
  )
);

comment on table public.pulse_reviews is
  'The CRP''s own levels for a Pulse recording they listened to. Where present, they count '
  'instead of the teacher''s and the engine''s.';

create index pulse_reviews_class_section_id_idx on public.pulse_reviews (class_section_id);
create index pulse_reviews_reviewed_by_idx on public.pulse_reviews (reviewed_by);

create table public.crp_tasks (
  id uuid primary key,
  cluster_id uuid not null references public.clusters (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  details text,
  source text not null default 'order',
  due_on date,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crp_tasks_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint crp_tasks_details_length check (
    details is null or char_length(btrim(details)) between 1 and 2000
  ),
  constraint crp_tasks_source_valid check (source in ('order', 'circular', 'meeting', 'own'))
);

comment on table public.crp_tasks is
  'Work a CRP has to fit around the visits: orders and circulars from the block office, meeting '
  'actions, and their own reminders. Shared by the CRPs of the cluster.';

create index crp_tasks_cluster_id_idx on public.crp_tasks (cluster_id, due_on);
create index crp_tasks_school_id_idx on public.crp_tasks (school_id);
create index crp_tasks_created_by_idx on public.crp_tasks (created_by);

create trigger visits_touch_updated_at before update on public.visits
  for each row execute function private.touch_updated_at();
create trigger crp_tasks_touch_updated_at before update on public.crp_tasks
  for each row execute function private.touch_updated_at();

create trigger visit_requests_keep_identifier before update on public.visit_requests
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger visits_keep_identifier before update on public.visits
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger visit_moments_keep_identifier before update on public.visit_moments
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger crp_tasks_keep_identifier before update on public.crp_tasks
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Clusters the signed-in user works in as a CRP today.
create function private.crp_cluster_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct cluster_id), '{}')
  from private.active_assignments()
  where role = 'crp'
$$;

-- Whether the signed-in CRP may change a visit and what it holds: their own visit, at a school of
-- their cluster, planned or at most 14 days old. The age counts from the visit's date or from when
-- the server first recorded it, whichever is earlier, so that re-dating a visit cannot keep it open.
create function private.visit_writable(target_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.visits as v
    where v.id = target_visit_id
      and v.crp_id = auth.uid()
      and v.school_id = any (private.crp_school_ids())
      and (
        v.status = 'planned'
        or least(
          v.visited_on,
          coalesce((v.done_at at time zone 'Asia/Kolkata')::date, v.visited_on)
        ) >= private.today() - 14
      )
  )
$$;

-- Whether the signed-in teacher teaches the class, by the class's teacher list.
create function private.teaches_class(target_class_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_teachers as t
    join public.class_sections as c on c.id = t.class_section_id
    where t.class_section_id = target_class_section_id
      and t.teacher_id = auth.uid()
      and c.school_id = any (private.teacher_school_ids())
  )
$$;

-- The class of a recorded Pulse check, whoever asks, so that a review of a check the caller cannot
-- see is refused by the access policy rather than reported as a missing check.
create function private.recorded_check_class(target_check_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select class_section_id from public.pulse_checks where id = target_check_id and mode = 'recorded'
$$;

-- Whether the signed-in teacher may ask for a visit to a class: a class they teach, or any class of
-- their school that has no teacher assigned yet.
create function private.may_request_visit(target_class_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.class_section_school_id(target_class_section_id)
      = any (private.teacher_school_ids())
    and (
      private.teaches_class(target_class_section_id)
      or not exists (
        select 1 from public.class_teachers as t
        where t.class_section_id = target_class_section_id
      )
    )
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------

create function private.guard_visit_request_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.school_id := private.class_section_school_id(new.class_section_id);
    new.created_at := now();
    new.withdrawn_at := null;
    new.answered_by_visit_id := null;
    if new.school_id is null then
      raise exception 'There is no such class.' using errcode = '23503';
    end if;
    if not private.class_section_is_active(new.class_section_id) then
      raise exception 'Visits are requested for active classes.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- A request can only be withdrawn, once.
  if (new.class_section_id, new.school_id, new.requested_by, new.topic, new.note, new.created_at,
      new.answered_by_visit_id)
     is distinct from
     (old.class_section_id, old.school_id, old.requested_by, old.topic, old.note, old.created_at,
      old.answered_by_visit_id)
     or old.withdrawn_at is not null
     or old.answered_by_visit_id is not null
     or new.withdrawn_at is null
  then
    raise exception 'A request can only be withdrawn while it is open.' using errcode = '42501';
  end if;
  new.withdrawn_at := now();
  return new;
end;
$$;

create trigger visit_requests_guard_write before insert or update on public.visit_requests
  for each row execute function private.guard_visit_request_write();

create function private.guard_visit_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'done' and new.status <> 'done' then
      raise exception 'A visit that took place cannot be planned again.' using errcode = '23514';
    end if;
    if not private.is_api_user() then
      return new;
    end if;
    if coalesce(current_setting('agla.visit_change', true), '') = '' then
      raise exception 'A visit is saved whole, through save_visit.' using errcode = '42501';
    end if;
    new.revision := old.revision + 1;
    new.done_at := case
      when old.status = 'done' then old.done_at
      when new.status = 'done' then now()
    end;
    if old.status = 'done' and new.visited_on > old.visited_on then
      raise exception 'The date of a visit that took place can only be moved earlier.'
        using errcode = '23514';
    end if;
    new.client_change_id := nullif(current_setting('agla.visit_change', true), '')::uuid;
    if (new.class_section_id, new.school_id, new.crp_id, new.created_at)
       is distinct from (old.class_section_id, old.school_id, old.crp_id, old.created_at)
    then
      raise exception 'The class and the CRP of a visit cannot be changed.'
        using errcode = '42501';
    end if;
  elsif not private.is_api_user() then
    return new;
  else
    if coalesce(current_setting('agla.visit_change', true), '') = '' then
      raise exception 'A visit is saved whole, through save_visit.' using errcode = '42501';
    end if;
    new.done_at := case when new.status = 'done' then now() end;
    new.crp_id := auth.uid();
    new.created_at := now();
    new.revision := 1;
    new.client_change_id := nullif(current_setting('agla.visit_change', true), '')::uuid;
    new.school_id := private.class_section_school_id(new.class_section_id);
    if new.school_id is null then
      raise exception 'There is no such class.' using errcode = '23503';
    end if;
    if not private.class_section_is_active(new.class_section_id) then
      raise exception 'Visits are made to active classes.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'done'
     and (tg_op = 'INSERT' or new.visited_on is distinct from old.visited_on)
  then
    if new.visited_on > private.today() then
      raise exception 'A visit cannot take place in the future.' using errcode = '23514';
    end if;
    if new.visited_on < private.today() - 14 then
      raise exception 'A visit older than 14 days cannot be recorded.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'done'
     and abs((new.started_at at time zone 'Asia/Kolkata')::date - new.visited_on) > 1
  then
    raise exception 'A visit starts on the day it took place.' using errcode = '23514';
  end if;

  if new.status = 'planned'
     and (tg_op = 'INSERT' or new.planned_on is distinct from old.planned_on)
     and (new.planned_on < private.today() - 7 or new.planned_on > private.today() + 62)
  then
    raise exception 'Visits are planned from a week ago up to two months ahead.'
      using errcode = '23514';
  end if;

  if new.teacher_id is not null
     and (tg_op = 'INSERT' or new.teacher_id is distinct from old.teacher_id)
     and not private.is_teacher_at(new.teacher_id, new.school_id)
  then
    raise exception 'The teacher observed must teach at the school.' using errcode = '23514';
  end if;

  if new.follows_visit_id is not null
     and (tg_op = 'INSERT' or new.follows_visit_id is distinct from old.follows_visit_id)
     and not exists (
       select 1
       from public.visits as v
       join public.visit_feedback as f on f.visit_id = v.id
       where v.id = new.follows_visit_id
         and v.class_section_id = new.class_section_id
         and v.status = 'done'
     )
  then
    raise exception 'A follow-up checks a step agreed at an earlier visit to the same class.'
      using errcode = '23514';
  end if;

  if new.request_id is not null
     and (tg_op = 'INSERT' or new.request_id is distinct from old.request_id)
     and not exists (
       select 1 from public.visit_requests as r
       where r.id = new.request_id and r.class_section_id = new.class_section_id
     )
  then
    raise exception 'A visit answers a request of the same class.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger visits_guard_write before insert or update on public.visits
  for each row execute function private.guard_visit_write();

-- A visit that took place answers the request it names, and the class's open requests made
-- before it ended: a visit sent late from a phone that was offline does not answer a request the
-- teacher made after it.
create function private.close_requests_of_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    update public.visit_requests
    set answered_by_visit_id = new.id
    where class_section_id = new.class_section_id
      and withdrawn_at is null
      and answered_by_visit_id is null
      and (
        id = new.request_id
        or created_at <= least(coalesce(new.finished_at, new.started_at + interval '12 hours'), now())
      );
  end if;
  return null;
end;
$$;

create trigger visits_close_requests after insert or update of status on public.visits
  for each row execute function private.close_requests_of_visit();

-- The parts of a visit change only with the visit, through `save_visit`, which counts every change
-- as a revision; a direct write would bypass that.
create function private.guard_visit_part_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_user() and coalesce(current_setting('agla.visit_change', true), '') = '' then
    raise exception 'A visit is saved whole, through save_visit.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger visit_observations_saved_whole
  before insert or update or delete on public.visit_observations
  for each row execute function private.guard_visit_part_write();
create trigger visit_moments_saved_whole
  before insert or update or delete on public.visit_moments
  for each row execute function private.guard_visit_part_write();
create trigger visit_rechecks_saved_whole
  before insert or update or delete on public.visit_rechecks
  for each row execute function private.guard_visit_part_write();
create trigger visit_feedback_saved_whole
  before insert or update or delete on public.visit_feedback
  for each row execute function private.guard_visit_part_write();

create function private.guard_visit_moment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.visit_id is distinct from old.visit_id then
    raise exception 'A moment cannot move to another visit.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.visit_moments where visit_id = new.visit_id) >= 60
  then
    raise exception 'A visit holds at most 60 moments.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger visit_moments_guard_write before insert or update on public.visit_moments
  for each row execute function private.guard_visit_moment_write();

create function private.guard_visit_recheck_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.visits as v
    join public.pulse_checks as k on k.class_section_id = v.class_section_id
    where v.id = new.visit_id and k.id = new.check_id and v.status = 'done'
  ) then
    raise exception 'A re-check is of a Pulse check of the visited class, during the visit.'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.visit_rechecks where visit_id = new.visit_id) >= 2
  then
    raise exception 'A visit re-checks at most two children.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger visit_rechecks_guard_write before insert or update on public.visit_rechecks
  for each row execute function private.guard_visit_recheck_write();

create function private.guard_visit_feedback_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  visited date;
  reference jsonb;
begin
  select v.visited_on into visited
  from public.visits as v
  where v.id = new.visit_id and v.status = 'done';
  if not found then
    raise exception 'Feedback follows a visit that took place.' using errcode = '23514';
  end if;
  if new.check_back_on < visited + 3 or new.check_back_on > visited + 42 then
    raise exception 'The check-back falls between 3 days and 6 weeks after the visit.'
      using errcode = '23514';
  end if;

  for reference in select value from jsonb_array_elements(new.evidence) loop
    if jsonb_typeof(reference) <> 'object' or (select count(*) from jsonb_object_keys(reference)) <> 1
    then
      raise exception 'Each piece of evidence names one moment or one focus item.'
        using errcode = '22023';
    end if;
    if reference ? 'moment' then
      if jsonb_typeof(reference -> 'moment') <> 'string'
         or (reference ->> 'moment') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (
           select 1 from public.visit_moments as m
           where m.visit_id = new.visit_id and m.id = (reference ->> 'moment')::uuid
         )
      then
        raise exception 'The evidence names a moment of another visit.' using errcode = '23514';
      end if;
    elsif reference ? 'item' then
      if jsonb_typeof(reference -> 'item') <> 'string'
         or not exists (
           select 1 from public.visit_observations as o
           where o.visit_id = new.visit_id and o.item_code = reference ->> 'item'
         )
      then
        raise exception 'The evidence names a focus item of another visit.' using errcode = '23514';
      end if;
    else
      raise exception 'Each piece of evidence names one moment or one focus item.'
        using errcode = '22023';
    end if;
  end loop;

  -- The device may note the agreement before it can send it; it cannot date it in the future, nor
  -- before the visit.
  if new.agreed_at is not null then
    new.agreed_at := least(new.agreed_at, now());
    if new.agreed_at < (select v.started_at - interval '1 day' from public.visits as v
                         where v.id = new.visit_id) then
      raise exception 'The agreement cannot be before the visit.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger visit_feedback_guard_write before insert or update on public.visit_feedback
  for each row execute function private.guard_visit_feedback_write();

create function private.guard_pulse_review_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  checked_class uuid := private.recorded_check_class(new.check_id);
begin
  if tg_op = 'UPDATE' and new.check_id is distinct from old.check_id then
    raise exception 'A review cannot move to another check.' using errcode = '42501';
  end if;
  if checked_class is null then
    raise exception 'Only recorded checks are reviewed.' using errcode = '23514';
  end if;
  new.class_section_id := checked_class;
  if private.is_api_user() then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger pulse_reviews_guard_write before insert or update on public.pulse_reviews
  for each row execute function private.guard_pulse_review_write();

create function private.guard_crp_task_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  elsif (new.cluster_id, new.created_by, new.created_at)
        is distinct from (old.cluster_id, old.created_by, old.created_at)
  then
    raise exception 'The cluster and author of a task cannot be changed.' using errcode = '42501';
  end if;
  if new.school_id is not null
     and (tg_op = 'INSERT' or new.school_id is distinct from old.school_id)
     and not exists (
       select 1 from public.schools as s
       where s.id = new.school_id and s.cluster_id = new.cluster_id
     )
  then
    raise exception 'The school of a task must be in its cluster.' using errcode = '23514';
  end if;
  if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
    new.done_at := least(new.done_at, now());
  end if;
  return new;
end;
$$;

create trigger crp_tasks_guard_write before insert or update on public.crp_tasks
  for each row execute function private.guard_crp_task_write();

revoke all on function private.crp_cluster_ids() from public;
revoke all on function private.visit_writable(uuid) from public;
revoke all on function private.teaches_class(uuid) from public;
revoke all on function private.recorded_check_class(uuid) from public;
revoke all on function private.may_request_visit(uuid) from public;
revoke all on function private.guard_visit_part_write() from public;
revoke all on function private.guard_visit_request_write() from public;
revoke all on function private.guard_visit_write() from public;
revoke all on function private.close_requests_of_visit() from public;
revoke all on function private.guard_visit_moment_write() from public;
revoke all on function private.guard_visit_recheck_write() from public;
revoke all on function private.guard_visit_feedback_write() from public;
revoke all on function private.guard_pulse_review_write() from public;
revoke all on function private.guard_crp_task_write() from public;

grant execute on function
  private.crp_cluster_ids(),
  private.visit_writable(uuid),
  private.teaches_class(uuid),
  private.recorded_check_class(uuid),
  private.may_request_visit(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

alter table public.visit_requests enable row level security;
alter table public.visits enable row level security;
alter table public.visit_observations enable row level security;
alter table public.visit_moments enable row level security;
alter table public.visit_rechecks enable row level security;
alter table public.visit_feedback enable row level security;
alter table public.pulse_reviews enable row level security;
alter table public.crp_tasks enable row level security;

revoke all on table public.visit_requests from anon, authenticated, service_role;
revoke all on table public.visits from anon, authenticated, service_role;
revoke all on table public.visit_observations from anon, authenticated, service_role;
revoke all on table public.visit_moments from anon, authenticated, service_role;
revoke all on table public.visit_rechecks from anon, authenticated, service_role;
revoke all on table public.visit_feedback from anon, authenticated, service_role;
revoke all on table public.pulse_reviews from anon, authenticated, service_role;
revoke all on table public.crp_tasks from anon, authenticated, service_role;

grant select, insert, update on table public.visit_requests to authenticated;
grant select, insert, update, delete on table public.visits to authenticated;
grant select, insert, update, delete on table public.visit_observations to authenticated;
grant select, insert, update, delete on table public.visit_moments to authenticated;
grant select, insert, update, delete on table public.visit_rechecks to authenticated;
grant select, insert, update, delete on table public.visit_feedback to authenticated;
grant select, insert, update on table public.pulse_reviews to authenticated;
grant select, insert, update, delete on table public.crp_tasks to authenticated;

-- The scheduled notifications read who is due for what.
grant select on table public.visits to service_role;
grant select on table public.visit_feedback to service_role;

create policy "Staff can read visit requests of their classes" on public.visit_requests
  for select to authenticated
  using (
    (select private.is_super_admin())
    or school_id = any ((select private.crp_school_ids())::uuid[])
    or requested_by = (select auth.uid())
    or private.teaches_class(class_section_id)
  );
create policy "Teachers can ask for a visit to their class" on public.visit_requests
  for insert to authenticated
  with check (private.may_request_visit(class_section_id));
create policy "Teachers can withdraw requests for their class" on public.visit_requests
  for update to authenticated
  using (requested_by = (select auth.uid()) or private.teaches_class(class_section_id))
  with check (requested_by = (select auth.uid()) or private.teaches_class(class_section_id));

create policy "CRPs and observed teachers can read visits" on public.visits
  for select to authenticated
  using (
    (select private.is_super_admin())
    or school_id = any ((select private.crp_school_ids())::uuid[])
    or (
      status = 'done'
      and school_id = any ((select private.teacher_school_ids())::uuid[])
      and (
        teacher_id = (select auth.uid())
        or (teacher_id is null and private.teaches_class(class_section_id))
      )
    )
  );
create policy "CRPs can plan and record visits in their cluster" on public.visits
  for insert to authenticated
  with check (school_id = any ((select private.crp_school_ids())::uuid[]));
create policy "CRPs can change their recent visits" on public.visits
  for update to authenticated
  using (private.visit_writable(id))
  with check (school_id = any ((select private.crp_school_ids())::uuid[]));
create policy "CRPs can drop planned visits" on public.visits
  for delete to authenticated
  using (status = 'planned' and private.visit_writable(id));

create policy "Readers of a visit can read what was observed" on public.visit_observations
  for select to authenticated
  using (exists (select 1 from public.visits as v where v.id = visit_observations.visit_id));
create policy "The visit's CRP can record what was observed" on public.visit_observations
  for all to authenticated
  using (private.visit_writable(visit_id))
  with check (private.visit_writable(visit_id));

create policy "Readers of a visit can read its moments" on public.visit_moments
  for select to authenticated
  using (exists (select 1 from public.visits as v where v.id = visit_moments.visit_id));
create policy "The visit's CRP can tag moments" on public.visit_moments
  for all to authenticated
  using (private.visit_writable(visit_id))
  with check (private.visit_writable(visit_id));

create policy "Readers of a visit can read its re-checks" on public.visit_rechecks
  for select to authenticated
  using (exists (select 1 from public.visits as v where v.id = visit_rechecks.visit_id));
create policy "The visit's CRP can re-check children" on public.visit_rechecks
  for all to authenticated
  using (private.visit_writable(visit_id))
  with check (private.visit_writable(visit_id));

create policy "Readers of a visit can read its feedback" on public.visit_feedback
  for select to authenticated
  using (exists (select 1 from public.visits as v where v.id = visit_feedback.visit_id));
create policy "The visit's CRP can write the feedback" on public.visit_feedback
  for all to authenticated
  using (private.visit_writable(visit_id))
  with check (private.visit_writable(visit_id));

-- The teacher sees the CRP's decision on their class's recordings, as they see the scores.
create policy "Staff can read reviews of their schools' recordings" on public.pulse_reviews
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.class_section_school_id(class_section_id)
       = any ((select private.staff_school_ids())::uuid[])
  );
create policy "CRPs can review recordings of their cluster" on public.pulse_reviews
  for insert to authenticated
  with check (
    private.class_section_school_id(class_section_id)
      = any ((select private.crp_school_ids())::uuid[])
  );
create policy "CRPs can revise reviews of their cluster" on public.pulse_reviews
  for update to authenticated
  using (
    private.class_section_school_id(class_section_id)
      = any ((select private.crp_school_ids())::uuid[])
  )
  with check (
    private.class_section_school_id(class_section_id)
      = any ((select private.crp_school_ids())::uuid[])
  );

create policy "CRPs share the tasks of their cluster" on public.crp_tasks
  for all to authenticated
  using (cluster_id = any ((select private.crp_cluster_ids())::uuid[]))
  with check (cluster_id = any ((select private.crp_cluster_ids())::uuid[]));
create policy "Administrators can read CRP tasks" on public.crp_tasks
  for select to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------------------------
-- Saving a visit
-- ---------------------------------------------------------------------------------------------

-- Saves a whole visit as the device holds it: the visit, its focus items, moments, re-checks and
-- feedback, replacing what the server held. Returns the visit's new revision.
--
-- `base_revision` is the revision the device started from, `change_id` a new identifier of this
-- save and `supersedes` the identifiers of the device's earlier saves of the visit. The server's
-- visit is replaced when it is still the base revision, or when one of those earlier saves wrote
-- it (the CRP changed the visit again before the first change was answered). A save already
-- applied (its answer was lost) is not applied twice. A visit changed by another device is
-- refused (40001) rather than overwritten.
create function public.save_visit(visit jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  base integer;
  held integer;
  held_change uuid;
  change_id uuid;
  supersedes uuid[];
  saved integer;
  attempt integer := 0;
begin
  if jsonb_typeof(visit) is distinct from 'object' or jsonb_typeof(visit -> 'id') <> 'string' then
    raise exception 'A visit is an object with an id.' using errcode = '22023';
  end if;
  target_id := (visit ->> 'id')::uuid;
  if jsonb_typeof(visit -> 'base_revision') not in ('number', 'null') then
    raise exception 'The base revision is a number.' using errcode = '22023';
  end if;
  base := (visit ->> 'base_revision')::integer;
  if jsonb_typeof(visit -> 'change_id') <> 'string' then
    raise exception 'A save carries its change identifier.' using errcode = '22023';
  end if;
  change_id := (visit ->> 'change_id')::uuid;
  supersedes := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(visit -> 'supersedes') as value),
    '{}'
  );
  if cardinality(supersedes) > 50 then
    raise exception 'A save supersedes at most 50 earlier saves.' using errcode = '22023';
  end if;

  loop
    attempt := attempt + 1;
    -- A save already applied (its answer was lost) is answered again, even once the visit closed.
    select v.revision, v.client_change_id into held, held_change
    from public.visits as v
    where v.id = target_id;
    if found and held_change = change_id then
      return held;
    end if;

    if found then
      select v.revision, v.client_change_id into held, held_change
      from public.visits as v
      where v.id = target_id and private.visit_writable(v.id)
      for update;
      if not found then
        raise exception 'This visit can no longer be changed.' using errcode = '42501';
      end if;
      if held_change = change_id then
        return held;
      end if;
      if base is distinct from held
         and not (held_change is not null and held_change = any (supersedes))
      then
        raise exception 'The visit was changed on another device.' using errcode = '40001';
      end if;
      -- Only this function stamps the save's identifier on the visit and writes its parts.
      perform set_config('agla.visit_change', change_id::text, true);
      update public.visits
      set teacher_id = nullif(visit ->> 'teacher_id', '')::uuid,
        status = visit ->> 'status',
        planned_on = nullif(visit ->> 'planned_on', '')::date,
        visited_on = nullif(visit ->> 'visited_on', '')::date,
        started_at = nullif(visit ->> 'started_at', '')::timestamptz,
        finished_at = nullif(visit ->> 'finished_at', '')::timestamptz,
        lesson_note = nullif(btrim(visit ->> 'lesson_note'), ''),
        follows_visit_id = nullif(visit ->> 'follows_visit_id', '')::uuid,
        follow_up_result = nullif(visit ->> 'follow_up_result', ''),
        request_id = nullif(visit ->> 'request_id', '')::uuid
      where id = target_id;
      exit;
    end if;

    if base is not null then
      raise exception 'The visit was removed on another device.' using errcode = '40001';
    end if;
    perform set_config('agla.visit_change', change_id::text, true);
    insert into public.visits (
      id, class_section_id, teacher_id, status, planned_on, visited_on, started_at, finished_at,
      lesson_note, follows_visit_id, follow_up_result, request_id
    )
    values (
      target_id,
      (visit ->> 'class_section_id')::uuid,
      nullif(visit ->> 'teacher_id', '')::uuid,
      visit ->> 'status',
      nullif(visit ->> 'planned_on', '')::date,
      nullif(visit ->> 'visited_on', '')::date,
      nullif(visit ->> 'started_at', '')::timestamptz,
      nullif(visit ->> 'finished_at', '')::timestamptz,
      nullif(btrim(visit ->> 'lesson_note'), ''),
      nullif(visit ->> 'follows_visit_id', '')::uuid,
      nullif(visit ->> 'follow_up_result', ''),
      nullif(visit ->> 'request_id', '')::uuid
    )
    on conflict (id) do nothing;
    if found then
      exit;
    end if;
    -- Another save of the same visit arrived first, or the visit is not the caller's to see.
    if attempt >= 2 then
      raise exception 'This visit can no longer be changed.' using errcode = '42501';
    end if;
  end loop;

  -- The feedback refers to moments and focus items, so it goes first and returns last. A save
  -- without feedback (the device's draft of it was not complete) keeps the feedback held here.
  if visit ? 'feedback' then
    delete from public.visit_feedback where visit_id = target_id;
  end if;
  delete from public.visit_rechecks where visit_id = target_id;
  delete from public.visit_moments where visit_id = target_id;
  delete from public.visit_observations where visit_id = target_id;

  insert into public.visit_observations (visit_id, item_code, position, answer, note)
  select target_id, o.item_code, o.position, o.answer, nullif(btrim(o.note), '')
  from jsonb_to_recordset(coalesce(visit -> 'observations', '[]'))
    as o (item_code text, position smallint, answer text, note text);

  insert into public.visit_moments (id, visit_id, tag_code, at_seconds, note)
  select m.id, target_id, m.tag_code, m.at_seconds, nullif(btrim(m.note), '')
  from jsonb_to_recordset(coalesce(visit -> 'moments', '[]'))
    as m (id uuid, tag_code text, at_seconds integer, note text);

  insert into public.visit_rechecks (visit_id, check_id, reading_level, english_level, note)
  select target_id, r.check_id, r.reading_level, r.english_level, nullif(btrim(r.note), '')
  from jsonb_to_recordset(coalesce(visit -> 'rechecks', '[]'))
    as r (check_id uuid, reading_level text, english_level text, note text);

  if jsonb_typeof(visit -> 'feedback') = 'object' then
    insert into public.visit_feedback (
      visit_id, strength, evidence, practice_code, change_note, technique, demo_given, plan_note,
      check_back_on, language, agreed_at
    )
    select target_id, btrim(f.strength), coalesce(f.evidence, '[]'), f.practice_code,
      nullif(btrim(f.change_note), ''), nullif(btrim(f.technique), ''),
      coalesce(f.demo_given, false), nullif(btrim(f.plan_note), ''), f.check_back_on,
      coalesce(f.language, 'hi'), f.agreed_at
    from jsonb_to_record(visit -> 'feedback') as f (
      strength text, evidence jsonb, practice_code text, change_note text, technique text,
      demo_given boolean, plan_note text, check_back_on date, language text, agreed_at timestamptz
    );
  elsif not (visit ? 'feedback') then
    -- Evidence of moments or focus items no longer in the visit is dropped from the kept feedback;
    -- feedback whose evidence is all still there is left untouched.
    update public.visit_feedback as f
    set evidence = kept.evidence
    from (
      select coalesce(jsonb_agg(entry.value order by entry.position), '[]') as evidence
      from public.visit_feedback as held_feedback
      cross join lateral jsonb_array_elements(held_feedback.evidence)
        with ordinality as entry (value, position)
      where held_feedback.visit_id = target_id
        and (
          exists (
            select 1 from public.visit_moments as m
            where m.visit_id = target_id and m.id::text = entry.value ->> 'moment'
          )
          or exists (
            select 1 from public.visit_observations as o
            where o.visit_id = target_id and o.item_code = entry.value ->> 'item'
          )
        )
    ) as kept
    where f.visit_id = target_id and f.evidence is distinct from kept.evidence;
  end if;

  perform set_config('agla.visit_change', '', true);
  select v.revision into saved from public.visits as v where v.id = target_id;
  return saved;
end;
$$;

comment on function public.save_visit(jsonb) is
  'Saves a whole visit as one change: the visit, its focus items, moments, re-checks and feedback.';

grant execute on function public.save_visit(jsonb) to authenticated;
revoke all on function public.save_visit(jsonb) from public, anon;

-- ---------------------------------------------------------------------------------------------
-- The cluster's signal, for planning
-- ---------------------------------------------------------------------------------------------

-- One row per current class of the CRP's schools, with what the week's plan is ranked by: the
-- latest Pulse of the class (this month's, or last month's while this month has fewer than five
-- children checked), the last visit, a step waiting for its check-back, and an open request.
--
-- A child's reading counts by the CRP's review where there is one, else by the teacher's form.
-- `to_listen` counts recordings of both months the CRP has not reviewed, while their audio is
-- kept, where the engine was unsure, or where it and the teacher differ on the reading level or by
-- two levels on English.
create function public.crp_class_signal()
returns table (
  class_section_id uuid,
  school_id uuid,
  grade smallint,
  section text,
  medium text,
  pulse_month date,
  pulse_checked integer,
  needs_support integer,
  hesitant integer,
  fluent integer,
  english_no_response integer,
  to_listen integer,
  last_visit_on date,
  visits_this_year integer,
  check_back_on date,
  check_back_visit_id uuid,
  request_topic text,
  requested_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with classes as (
    select c.id, c.school_id, c.grade, c.section, c.medium, y.starts_on as year_start
    from public.class_sections as c
    join public.academic_years as y on y.id = c.academic_year_id
    where c.school_id = any (private.crp_school_ids())
      and c.is_active
      and private.today() between y.starts_on and y.ends_on
  ),
  -- The latest attempt of each drawn child, by month.
  latest as (
    select distinct on (k.sample_id)
      k.id, k.class_section_id, cy.month, k.mode, k.reading_level, k.english_level,
      k.audio_deleted_at
    from public.pulse_checks as k
    join public.pulse_samples as s on s.id = k.sample_id
    join public.pulse_cycles as cy on cy.id = s.cycle_id
    join classes on classes.id = k.class_section_id
    where cy.month >= (date_trunc('month', private.today()) - interval '1 month')::date
    order by k.sample_id, k.attempt desc
  ),
  levels as (
    select l.*,
      coalesce(r.reading_level, l.reading_level) as reading,
      coalesce(r.english_level, l.english_level) as english,
      r.check_id is not null as reviewed,
      p.check_id is not null as scored,
      p.reading_level as machine_reading,
      p.english_level as machine_english,
      coalesce(p.flags && array['low_confidence', 'no_speech', 'quiet'], false) as unsure
    from latest as l
    left join public.pulse_reviews as r on r.check_id = l.id
    left join public.pulse_scores as p on p.check_id = l.id
  ),
  months as (
    select l.class_section_id, l.month, count(*)::integer as checked
    from levels as l
    group by l.class_section_id, l.month
  ),
  chosen as (
    select distinct on (m.class_section_id) m.class_section_id, m.month
    from months as m
    order by m.class_section_id,
      (m.month = date_trunc('month', private.today())::date and m.checked >= 5) desc,
      (m.month < date_trunc('month', private.today())::date) desc,
      m.month desc
  )
  select
    classes.id,
    classes.school_id,
    classes.grade,
    classes.section,
    classes.medium,
    chosen.month,
    coalesce(pulse.checked, 0),
    coalesce(pulse.needs_support, 0),
    coalesce(pulse.hesitant, 0),
    coalesce(pulse.fluent, 0),
    coalesce(pulse.english_no_response, 0),
    coalesce(listening.to_listen, 0),
    seen.last_visit_on,
    coalesce(seen.visits_this_year, 0),
    due.check_back_on,
    due.visit_id,
    request.topic,
    request.created_at
  from classes
  left join chosen on chosen.class_section_id = classes.id
  left join lateral (
    select
      count(*)::integer as checked,
      count(*) filter (where l.reading = 'needs_support')::integer as needs_support,
      count(*) filter (where l.reading = 'hesitant')::integer as hesitant,
      count(*) filter (where l.reading = 'fluent')::integer as fluent,
      count(*) filter (where l.english = 'no_response')::integer as english_no_response
    from levels as l
    where l.class_section_id = classes.id and l.month = chosen.month
  ) as pulse on true
  -- Recordings to listen to, in both months while their audio is kept.
  left join lateral (
    select count(*)::integer as to_listen
    from levels as l
    where l.class_section_id = classes.id
      and l.mode = 'recorded'
      and l.audio_deleted_at is null
      and l.scored
      and not l.reviewed
      and (
        l.unsure
        or l.machine_reading is distinct from l.reading_level
        or (l.english_level, l.machine_english) in
           (('sentences', 'no_response'), ('no_response', 'sentences'))
      )
  ) as listening on true
  left join lateral (
    select max(v.visited_on) as last_visit_on, count(*)::integer as visits_this_year
    from public.visits as v
    where v.class_section_id = classes.id
      and v.status = 'done'
      and v.visited_on >= classes.year_start
  ) as seen on true
  left join lateral (
    -- The latest agreed step of the class that no later visit has followed up.
    select f.check_back_on, v.id as visit_id
    from public.visits as v
    join public.visit_feedback as f on f.visit_id = v.id
    where v.class_section_id = classes.id
      and v.status = 'done'
      and f.agreed_at is not null
      and not exists (
        select 1 from public.visits as later
        where later.follows_visit_id = v.id and later.status = 'done'
      )
    order by v.visited_on desc, v.started_at desc
    limit 1
  ) as due on true
  left join lateral (
    select r.topic, r.created_at
    from public.visit_requests as r
    where r.class_section_id = classes.id
      and r.withdrawn_at is null
      and r.answered_by_visit_id is null
    limit 1
  ) as request on true
  order by classes.school_id, classes.grade, classes.section
$$;

comment on function public.crp_class_signal() is
  'The current classes of the CRP''s schools with what the week''s plan is ranked by.';

grant execute on function public.crp_class_signal() to authenticated;
revoke all on function public.crp_class_signal() from public, anon;
