-- Pulse: a one-minute voice check of a random sample of each class, recorded by the teacher.
--
-- Each check has two parts in one recording of at most 60 seconds: the child reads a passage in the
-- class's language (Hindi or English medium), stepping down to words and then letters if needed,
-- and then speaks a few sentences of English about pictures. Children with special needs receive an
-- adapted check instead: the teacher observes and records levels, nothing is recorded and nothing is
-- scored by a machine.
--
-- A monthly cycle per Grade 1 to 3 class:
--   * The database draws up to 20 children, plus up to 10 more as a hidden reserve. Eligible are
--     verified (active) students enrolled in the class on the day of the draw whose guardian has
--     granted consent for audio checks, and every child with special needs (their adapted check
--     records no audio).
--   * Consent counts as it stood a week before the draw as well as on the day, so withdrawing it on
--     the eve of the draw cannot quietly take a child out: such a child is drawn and then replaced
--     with the reason "consent", which the CRP sees. No child is ever recorded without consent.
--   * The draw orders the eligible children by the SHA-256 hash of "<seed>:<student id>" and takes
--     them in that order. The seed is a random value kept with the list of eligible children, so the
--     draw can be repeated and verified, and is not readable through the API.
--   * The month has four weeks: days 1-7, 8-14, 15-21 and 22-28. Days 29 to the end of the month are
--     for catching up. Five children are due each week; a class drawn later in the month (for
--     example a new class) gets five for each week that is left.
--   * A teacher sees a child only once the child's week has opened, by the database's calendar date
--     in India: changing the device clock unlocks nothing, and the reserve is never visible.
--   * Each week's children are also sent ahead, encrypted with a key of that week. The teacher's
--     phone keeps the next two weeks; the key is released when the week opens. Without a network,
--     the CRP's phone, which holds the keys of the cluster, shows the week's key as a QR code during
--     a visit. So that a phone can hold the first week of a month before it begins, next month's
--     cycle is drawn from the 25th, from the children enrolled and consenting on that day. This
--     happens within an academic year only: the first month of a new year is drawn on its first
--     day, once its classes exist.
--   * A child who is still not recorded when their week ends is replaced for absence only when
--     the teacher marked them absent on a day of the week and the attendance register shows them
--     present on none of its days: a child who came to school during the week could have been
--     recorded. A child who has left the class, and a child whose consent was withdrawn, are
--     replaced at once. Replacements are the next children in the reserve who are still enrolled
--     and eligible, due by the end of the week in which they open. Every replacement is kept, with
--     its reason. Children replaced after a phone received its encrypted week appear on it only once
--     it is online again. In a 28-day February there are no days left after week 4, so children
--     absent in that week are not replaced.
--
-- A recorded check is uploaded to the private `pulse-audio` bucket first, under
-- `<class section>/<drawn child>/<check>.<extension>`, then recorded here. Storage accepts the file
-- only for a child of the teacher's school who is due and whose family consents to audio checks;
-- the database verifies that the file exists, was uploaded by the same teacher and was not used for
-- another check, and that the passage and prompt are ones for the class's language and grade.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.pulse_cycles (
  id uuid primary key default gen_random_uuid(),
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  month date not null,
  grade smallint not null,
  language text not null,
  first_week smallint not null,
  eligible_count smallint not null,
  sample_size smallint not null,
  reserve_size smallint not null,
  drawn_at timestamptz not null default now(),
  constraint pulse_cycles_class_section_month_key unique (class_section_id, month),
  constraint pulse_cycles_month_first_day check (extract(day from month) = 1),
  constraint pulse_cycles_grade_range check (grade between 1 and 3),
  constraint pulse_cycles_language_valid check (language in ('hi', 'en')),
  constraint pulse_cycles_first_week_range check (first_week between 1 and 4),
  constraint pulse_cycles_sizes_valid check (
    sample_size between 0 and 20
    and reserve_size between 0 and 10
    and sample_size + reserve_size <= eligible_count
  )
);

comment on table public.pulse_cycles is
  'One month of Pulse checks for a class: how many children were drawn, and from how many.';
comment on column public.pulse_cycles.language is
  'Language of the reading passage: the class''s medium. The speaking part is always English.';
comment on column public.pulse_cycles.first_week is
  'Week of the month in which the cycle was drawn; earlier weeks have no children.';

-- The seed and the sampling frame stay out of the API until they can no longer help anyone to
-- foresee which children come next.
create table private.pulse_draws (
  cycle_id uuid primary key references public.pulse_cycles (id) on delete cascade,
  seed text not null,
  eligible_student_ids uuid[] not null,
  constraint pulse_draws_seed_format check (seed ~ '^[0-9a-f]{64}$')
);

comment on table private.pulse_draws is
  'Seed and sampling frame of each draw, for repeating and verifying it.';

create table public.pulse_samples (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.pulse_cycles (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  draw_position smallint not null,
  adapted boolean not null default false,
  week smallint,
  opens_on date,
  due_on date,
  replaces_sample_id uuid references public.pulse_samples (id) on delete set null,
  replaced_at timestamptz,
  replacement_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulse_samples_cycle_student_key unique (cycle_id, student_id),
  constraint pulse_samples_cycle_position_key unique (cycle_id, draw_position),
  constraint pulse_samples_position_range check (draw_position between 1 and 30),
  constraint pulse_samples_schedule_valid check (
    (week is null and opens_on is null and due_on is null)
    or (week between 1 and 4 and opens_on is not null and due_on is not null and due_on >= opens_on)
  ),
  constraint pulse_samples_replacement_valid check (
    (replaced_at is null and replacement_reason is null)
    or (replaced_at is not null and replacement_reason in ('absent', 'left', 'consent'))
  )
);

comment on table public.pulse_samples is
  'Children drawn for a Pulse cycle. A row without a week is in the hidden reserve.';
comment on column public.pulse_samples.adapted is
  'The child has special needs and receives the adapted, teacher-observed check (no recording).';
comment on column public.pulse_samples.opens_on is
  'First day the child is shown to the teacher.';
comment on column public.pulse_samples.due_on is
  'Last day of the child''s week; a check after it is late but still accepted until the month ends.';
comment on column public.pulse_samples.replaces_sample_id is
  'For a child taken from the reserve: the child this one replaces.';
comment on column public.pulse_samples.replaced_at is
  'When the child was replaced by a child from the reserve, for `replacement_reason`.';

create index pulse_samples_class_section_opens_on_idx
  on public.pulse_samples (class_section_id, opens_on);
create index pulse_samples_student_id_idx on public.pulse_samples (student_id);
create index pulse_samples_replaces_sample_id_idx on public.pulse_samples (replaces_sample_id);

create table public.pulse_absences (
  sample_id uuid not null references public.pulse_samples (id) on delete cascade,
  absent_on date not null,
  marked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (sample_id, absent_on)
);

comment on table public.pulse_absences is
  'Days on which a drawn child was absent. A child absent until the end of the week is replaced.';

create index pulse_absences_marked_by_idx on public.pulse_absences (marked_by);

-- Each week's children, encrypted with that week's key (AES-256-CBC, then HMAC-SHA-256 over the IV
-- and the ciphertext; both keys are derived from the week key with HMAC-SHA-256 of "enc" and "mac").
-- The content is JSON: {"v": 1, "cycle": ..., "week": ..., "children": [{"sample", "student",
-- "adapted"}]}.
create table public.pulse_week_batches (
  cycle_id uuid not null references public.pulse_cycles (id) on delete cascade,
  week smallint not null,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  opens_on date not null,
  iv bytea not null,
  ciphertext bytea not null,
  mac bytea not null,
  primary key (cycle_id, week),
  constraint pulse_week_batches_week_range check (week between 1 and 4),
  constraint pulse_week_batches_iv_length check (octet_length(iv) = 16),
  constraint pulse_week_batches_mac_length check (octet_length(mac) = 32)
);

comment on table public.pulse_week_batches is
  'Each week''s drawn children, encrypted, so that phones can hold them before the week opens.';

create index pulse_week_batches_class_section_opens_on_idx
  on public.pulse_week_batches (class_section_id, opens_on);

create table public.pulse_week_keys (
  cycle_id uuid not null references public.pulse_cycles (id) on delete cascade,
  week smallint not null,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  opens_on date not null,
  key bytea not null,
  primary key (cycle_id, week),
  constraint pulse_week_keys_week_range check (week between 1 and 4),
  constraint pulse_week_keys_key_length check (octet_length(key) = 32)
);

comment on table public.pulse_week_keys is
  'The key of each week''s children: released to teachers when the week opens, held by the CRP '
  'from two weeks before, to unlock a week by QR code where there is no network.';

create index pulse_week_keys_class_section_opens_on_idx
  on public.pulse_week_keys (class_section_id, opens_on);

create table public.pulse_checks (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.pulse_samples (id) on delete restrict,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  mode text not null default 'recorded',
  attempt smallint not null default 1,
  item_code text,
  prompt_code text,
  item jsonb not null default '{}',
  item_seen_before boolean not null default false,
  audio_path text,
  audio_type text,
  audio_bytes integer,
  duration_ms integer,
  noise_dbfs real,
  reading_level text not null,
  english_level text not null,
  clarity text,
  classroom text,
  tags text[] not null default '{}',
  recorded_at timestamptz not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  received_at timestamptz not null default now(),
  audio_deleted_at timestamptz,
  audio_etag text,
  constraint pulse_checks_sample_attempt_key unique (sample_id, attempt),
  constraint pulse_checks_audio_path_key unique (audio_path),
  constraint pulse_checks_audio_etag_key unique (audio_etag),
  constraint pulse_checks_mode_valid check (mode in ('recorded', 'adapted')),
  constraint pulse_checks_attempt_range check (attempt in (1, 2)),
  constraint pulse_checks_mode_shape check (
    (
      mode = 'recorded'
      and item_code is not null
      and prompt_code is not null
      and audio_path is not null
      and audio_type is not null
      and audio_bytes is not null
      and duration_ms is not null
      and clarity is not null
      and classroom is not null
    )
    or (
      mode = 'adapted'
      and attempt = 1
      and item_code is null
      and prompt_code is null
      and audio_path is null
      and audio_type is null
      and audio_bytes is null
      and duration_ms is null
      and noise_dbfs is null
    )
  ),
  constraint pulse_checks_item_code_format check (
    item_code is null or item_code ~ '^[a-z0-9][a-z0-9-]{2,47}$'
  ),
  constraint pulse_checks_prompt_code_format check (
    prompt_code is null or prompt_code ~ '^[a-z0-9][a-z0-9-]{2,47}$'
  ),
  constraint pulse_checks_item_shape check (
    jsonb_typeof(item) = 'object' and octet_length(item::text) <= 8192
  ),
  constraint pulse_checks_audio_bytes_range check (
    audio_bytes is null or audio_bytes between 1 and 2097152
  ),
  constraint pulse_checks_duration_range check (
    duration_ms is null or duration_ms between 1000 and 61000
  ),
  constraint pulse_checks_noise_range check (noise_dbfs is null or noise_dbfs between -160 and 0),
  constraint pulse_checks_reading_level_valid check (
    reading_level in ('fluent', 'hesitant', 'needs_support')
  ),
  constraint pulse_checks_english_level_valid check (
    english_level in ('sentences', 'words', 'no_response')
  ),
  constraint pulse_checks_clarity_valid check (
    clarity is null or clarity in ('clear', 'low_voice', 'nervous')
  ),
  constraint pulse_checks_classroom_valid check (
    classroom is null or classroom in ('normal', 'noisy')
  ),
  constraint pulse_checks_tags_valid check (
    tags <@ array['missed_words', 'good_pace', 'repeated_line', 'mixed_languages', 'needed_prompting']
    and cardinality(tags) <= 5
  )
);

comment on table public.pulse_checks is
  'Pulse checks. A check is never edited; a second recording is allowed once, with different '
  'items, when the teacher reported a noisy classroom.';
comment on column public.pulse_checks.id is
  'Chosen by the device, which also names the audio file after it, so a resend is recognised.';
comment on column public.pulse_checks.mode is
  'recorded: the voice check. adapted: the teacher-observed check of a child with special needs, '
  'with no recording and no machine scoring.';
comment on column public.pulse_checks.item_code is 'The reading passage.';
comment on column public.pulse_checks.prompt_code is 'The English speaking prompt.';
comment on column public.pulse_checks.item is
  'What was shown, and when: the passage, words and letters, the English prompt, and the moments '
  'the teacher stepped down or moved on.';
comment on column public.pulse_checks.item_seen_before is
  'The child had already been given this passage or prompt in an earlier check (a device that was '
  'offline did not know). Kept, and taken into account when the check is scored.';
comment on column public.pulse_checks.reading_level is
  'Teacher''s impression of the reading: fluent, hesitant, or needs basic support.';
comment on column public.pulse_checks.english_level is
  'Teacher''s impression of the English: spoke in sentences, said single words, or did not answer.';
comment on column public.pulse_checks.recorded_at is
  'Time of the check by the device clock; `received_at` is the server''s.';
comment on column public.pulse_checks.audio_deleted_at is
  'When the audio was removed after the 30-day listening window; the form and scores remain.';
comment on column public.pulse_checks.audio_etag is
  'Fingerprint of the stored recording, taken from storage: the same file cannot be sent for two '
  'checks.';

create index pulse_checks_class_section_id_idx on public.pulse_checks (class_section_id);
create index pulse_checks_student_item_idx on public.pulse_checks (student_id, item_code);
create index pulse_checks_student_prompt_idx on public.pulse_checks (student_id, prompt_code);
create index pulse_checks_recorded_by_idx on public.pulse_checks (recorded_by);
create index pulse_checks_received_at_idx on public.pulse_checks (received_at)
  where audio_deleted_at is null and audio_path is not null;

create trigger pulse_samples_touch_updated_at before update on public.pulse_samples
  for each row execute function private.touch_updated_at();

create trigger pulse_cycles_keep_identifier before update on public.pulse_cycles
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger pulse_samples_keep_identifier before update on public.pulse_samples
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger pulse_checks_keep_identifier before update on public.pulse_checks
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

-- ---------------------------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------------------------

-- Week of the month a day belongs to: 1 to 4, or 5 for the catching-up days after the 28th.
create function private.pulse_week_of(day date)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select least(5, (extract(day from day)::integer - 1) / 7 + 1)::smallint
$$;

-- Last day of the week (1 to 4) of the month, or the month's last day for the catching-up days.
create function private.pulse_week_end(month_start date, week smallint)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when week between 1 and 4 then month_start + week * 7 - 1
    else (month_start + interval '1 month' - interval '1 day')::date
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Drawing and replacing
-- ---------------------------------------------------------------------------------------------

-- Whether the decision in force at `moment` granted consent for the purpose.
create function private.had_guardian_consent_at(
  target_student_id uuid,
  consent_purpose text,
  moment timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.granted
     from public.guardian_consents as c
     where c.student_id = target_student_id
       and c.purpose = consent_purpose
       and c.recorded_at <= moment
     order by c.recorded_at desc
     limit 1),
    false
  )
$$;

-- Whether a verified child is enrolled in the class on the day.
create function private.pulse_child_enrolled(
  target_student_id uuid,
  target_class_section_id uuid,
  on_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrolments as e
    join public.students as s on s.id = e.student_id
    where e.student_id = target_student_id
      and e.class_section_id = target_class_section_id
      and e.enrolled_on <= on_date
      and (e.ended_on is null or e.ended_on >= on_date)
      and s.status = 'active'
  )
$$;

-- Whether the class's attendance register shows the child present on the day: a record of the
-- day exists and does not list the child as absent.
create function private.attendance_shows_present(
  target_class_section_id uuid,
  target_student_id uuid,
  day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attendance_sessions as a
    where a.class_section_id = target_class_section_id
      and a.attendance_date = day
      and not (target_student_id = any (a.absent_student_ids))
  )
$$;

-- Whether a child may take part in Pulse now: a child with special needs always (the adapted check
-- records nothing), any other child while the guardian's consent for audio checks is in force.
create function private.pulse_child_eligible(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.has_special_needs from public.students as s where s.id = target_student_id),
    false
  )
  or private.has_guardian_consent(target_student_id, 'audio_assessment')
$$;

-- Draws the cycle of a class for the month of `on_date`, or with `for_month` for the next month
-- (drawn ahead in the last days of a month), unless it exists already. The children are those
-- enrolled and eligible on `on_date`. Returns the cycle, or null when the class takes no part (not
-- Grade 1 to 3, inactive, outside its academic year, no week left in the month, or nobody eligible
-- yet; the daily job tries again the next day).
create function private.draw_pulse_cycle(
  target_class_section_id uuid,
  on_date date,
  for_month date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date;
  opening_week smallint;
  weeks_left integer;
  class_grade smallint;
  class_medium text;
  new_cycle_id uuid;
  draw_seed text;
  frame uuid[];
  ordered uuid[];
  eligible integer;
  sample_count integer;
  reserve_count integer;
  slot integer;
  week_of_child smallint;
  week_number smallint;
  week_children jsonb;
  week_opens_on date;
  week_key bytea;
  batch_iv bytea;
  batch_ciphertext bytea;
begin
  if for_month is null then
    month_start := date_trunc('month', on_date)::date;
    opening_week := private.pulse_week_of(on_date);
  elsif for_month = (date_trunc('month', on_date) + interval '1 month')::date then
    month_start := for_month;
    opening_week := 1;
  else
    return null;
  end if;
  if opening_week > 4 then
    return null;
  end if;

  -- Locks the class, so that two draws for it cannot run at the same time.
  select cs.grade, cs.medium into class_grade, class_medium
  from public.class_sections as cs
  join public.academic_years as y on y.id = cs.academic_year_id
  where cs.id = target_class_section_id
    and cs.is_active
    and cs.grade between 1 and 3
    and on_date between y.starts_on and y.ends_on
    and greatest(on_date, month_start) between y.starts_on and y.ends_on
  -- Enough to keep a second draw out without holding up attendance and other writes for the class.
  for no key update of cs;
  if not found then
    return null;
  end if;

  select c.id into new_cycle_id
  from public.pulse_cycles as c
  where c.class_section_id = target_class_section_id and c.month = month_start;
  if found then
    return new_cycle_id;
  end if;

  select coalesce(array_agg(s.id order by s.id), '{}') into frame
  from public.students as s
  join public.enrolments as e on e.student_id = s.id
  where e.class_section_id = target_class_section_id
    and e.enrolled_on <= on_date
    and (e.ended_on is null or e.ended_on >= on_date)
    and s.status = 'active'
    and (
      s.has_special_needs
      or private.has_guardian_consent(s.id, 'audio_assessment')
      or private.had_guardian_consent_at(
        s.id,
        'audio_assessment',
        (on_date - 7)::timestamp at time zone 'Asia/Kolkata'
      )
    );

  eligible := cardinality(frame);
  if eligible = 0 then
    return null;
  end if;

  draw_seed := encode(extensions.gen_random_bytes(32), 'hex');
  select array_agg(student_id order by extensions.digest(draw_seed || ':' || student_id::text, 'sha256'))
    into ordered
  from unnest(frame) as student_id;

  weeks_left := 5 - opening_week;
  sample_count := least(eligible, 5 * weeks_left);
  reserve_count := least(eligible - sample_count, 10);

  insert into public.pulse_cycles (
    class_section_id, month, grade, language, first_week, eligible_count, sample_size, reserve_size
  )
  values (
    target_class_section_id, month_start, class_grade, class_medium, opening_week, eligible,
    sample_count, reserve_count
  )
  returning id into new_cycle_id;

  insert into private.pulse_draws (cycle_id, seed, eligible_student_ids)
  values (new_cycle_id, draw_seed, frame);

  for slot in 1 .. sample_count + reserve_count loop
    if slot <= sample_count then
      -- Spreads the sample evenly over the weeks that are left.
      week_of_child := (opening_week + ((slot - 1) * weeks_left) / sample_count)::smallint;
      insert into public.pulse_samples (
        cycle_id, class_section_id, student_id, draw_position, adapted, week, opens_on, due_on
      )
      select
        new_cycle_id, target_class_section_id, s.id, slot, s.has_special_needs, week_of_child,
        -- A class drawn mid-week sees its first children from the day of the draw.
        greatest(month_start + (week_of_child - 1) * 7, on_date),
        private.pulse_week_end(month_start, week_of_child)
      from public.students as s
      where s.id = ordered[slot];
    else
      insert into public.pulse_samples (
        cycle_id, class_section_id, student_id, draw_position, adapted
      )
      select new_cycle_id, target_class_section_id, s.id, slot, s.has_special_needs
      from public.students as s
      where s.id = ordered[slot];
    end if;
  end loop;

  -- Each week's children, encrypted with the week's own key.
  for week_number in opening_week .. 4 loop
    select
      jsonb_agg(
        jsonb_build_object('sample', s.id, 'student', s.student_id, 'adapted', s.adapted)
        order by s.draw_position
      ),
      min(s.opens_on)
      into week_children, week_opens_on
    from public.pulse_samples as s
    where s.cycle_id = new_cycle_id and s.week = week_number;
    if week_children is null then
      continue;
    end if;

    week_key := extensions.gen_random_bytes(32);
    batch_iv := extensions.gen_random_bytes(16);
    batch_ciphertext := extensions.encrypt_iv(
      convert_to(
        jsonb_build_object(
          'v', 1, 'cycle', new_cycle_id, 'week', week_number, 'children', week_children
        )::text,
        'UTF8'
      ),
      extensions.hmac(convert_to('enc', 'UTF8'), week_key, 'sha256'),
      batch_iv,
      'aes-cbc/pad:pkcs'
    );
    insert into public.pulse_week_batches (
      cycle_id, week, class_section_id, opens_on, iv, ciphertext, mac
    )
    values (
      new_cycle_id, week_number, target_class_section_id, week_opens_on, batch_iv,
      batch_ciphertext,
      extensions.hmac(
        batch_iv || batch_ciphertext,
        extensions.hmac(convert_to('mac', 'UTF8'), week_key, 'sha256'),
        'sha256'
      )
    );
    insert into public.pulse_week_keys (cycle_id, week, class_section_id, opens_on, key)
    values (new_cycle_id, week_number, target_class_section_id, week_opens_on, week_key);
  end loop;

  return new_cycle_id;
end;
$$;

-- Replaces drawn children who were absent through their week without being recorded (marked absent
-- on a day of it, and shown present by the attendance register on none of its days), who have left
-- the class, or whose consent was withdrawn, with the next children in the reserve who are still
-- enrolled and consenting. Only the cycles of the month of `on_date` are considered: cycles drawn
-- ahead for the next month wait for their month. Returns how many were replaced.
create function private.replace_pulse_samples(on_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', on_date)::date;
  candidate record;
  reserve_id uuid;
  replaced integer := 0;
begin
  for candidate in
    select s.id, s.cycle_id, s.week,
      case
        when not private.pulse_child_enrolled(s.student_id, s.class_section_id, on_date) then 'left'
        when not private.pulse_child_eligible(s.student_id) then 'consent'
        else 'absent'
      end as reason
    from public.pulse_samples as s
    join public.pulse_cycles as c on c.id = s.cycle_id
    where c.month = month_start
      and s.week is not null
      and s.opens_on <= on_date
      and s.replaced_at is null
      and not exists (select 1 from public.pulse_checks as k where k.sample_id = s.id)
      and (
        not private.pulse_child_enrolled(s.student_id, s.class_section_id, on_date)
        or not private.pulse_child_eligible(s.student_id)
        or (
          s.due_on < on_date
          and exists (
            select 1
            from public.pulse_absences as a
            where a.sample_id = s.id
              and a.absent_on between s.opens_on and s.due_on
          )
          and not exists (
            select 1
            from generate_series(s.opens_on, s.due_on, interval '1 day') as d (day)
            where private.attendance_shows_present(s.class_section_id, s.student_id, d.day::date)
          )
        )
      )
    order by s.due_on, s.draw_position
    for update of s
  loop
    select r.id into reserve_id
    from public.pulse_samples as r
    where r.cycle_id = candidate.cycle_id
      and r.week is null
      and private.pulse_child_enrolled(r.student_id, r.class_section_id, on_date)
      and private.pulse_child_eligible(r.student_id)
    order by r.draw_position
    limit 1
    for update;
    if not found then
      continue;
    end if;

    update public.pulse_samples
    set week = candidate.week,
      opens_on = on_date,
      due_on = private.pulse_week_end(month_start, private.pulse_week_of(on_date)),
      replaces_sample_id = candidate.id
    where id = reserve_id;

    update public.pulse_samples
    set replaced_at = now(), replacement_reason = candidate.reason
    where id = candidate.id;

    replaced := replaced + 1;
  end loop;
  return replaced;
end;
$$;

-- The daily run: draws the month's cycle of every class that has none yet, from the 25th also next
-- month's, then replaces absent and departed children. Each draw, and the replacements, run on their
-- own: a failure is reported as a warning and leaves the rest of the night's work in place.
create function private.run_pulse_schedule(on_date date default private.today())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', on_date)::date;
  next_month date := (date_trunc('month', on_date) + interval '1 month')::date;
  target uuid;
  target_month date;
begin
  for target, target_month in
    select cs.id, m.month
    from public.class_sections as cs
    join public.academic_years as y on y.id = cs.academic_year_id
    cross join lateral (
      select month_start as month
      union all
      select next_month as month where extract(day from on_date) >= 25
    ) as m
    where cs.is_active
      and cs.grade between 1 and 3
      and on_date between y.starts_on and y.ends_on
      and not exists (
        select 1 from public.pulse_cycles as c
        where c.class_section_id = cs.id and c.month = m.month
      )
    order by m.month, cs.id
  loop
    begin
      perform private.draw_pulse_cycle(
        target,
        on_date,
        case when target_month = next_month then next_month end
      );
    exception when others then
      raise warning 'The Pulse draw of class % for % failed: %', target, target_month, sqlerrm;
    end;
  end loop;

  begin
    perform private.replace_pulse_samples(on_date);
  exception when others then
    raise warning 'The Pulse replacements of % failed: %', on_date, sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------

-- What the guards need to know about a drawn child, regardless of what the caller may read.
create function private.pulse_sample_context(target_sample_id uuid)
returns table (
  class_section_id uuid,
  student_id uuid,
  week smallint,
  opens_on date,
  due_on date,
  month date,
  adapted boolean,
  grade smallint,
  language text,
  replaced_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.class_section_id, s.student_id, s.week, s.opens_on, s.due_on, c.month, s.adapted,
    c.grade, c.language, s.replaced_at
  from public.pulse_samples as s
  join public.pulse_cycles as c on c.id = s.cycle_id
  where s.id = target_sample_id
$$;

-- The class and the drawn child a Pulse audio path belongs to, or null when the path is not of the
-- expected form `<class section id>/<sample id>/<check id>.<webm|ogg|m4a>`.
create function private.pulse_audio_class_section(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|m4a)$'
    then split_part(object_name, '/', 1)::uuid
  end
$$;

create function private.pulse_audio_sample(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when private.pulse_audio_class_section(object_name) is not null
    then split_part(object_name, '/', 2)::uuid
  end
$$;

-- Whether the signed-in teacher may store this recording now: the path names a drawn child of one
-- of their school's classes, in that class's folder, whose week has opened, who receives the
-- recorded check, and whose family consents to audio checks today. A recording made before a
-- replacement may still be stored; the check itself is refused if it was made afterwards.
create function private.pulse_audio_upload_allowed(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pulse_samples as s
    where s.id = private.pulse_audio_sample(object_name)
      and s.class_section_id = private.pulse_audio_class_section(object_name)
      and not s.adapted
      and s.week is not null
      and s.opens_on <= private.today()
      and private.class_section_school_id(s.class_section_id) = any (private.teacher_school_ids())
      and private.has_guardian_consent(s.student_id, 'audio_assessment')
  )
$$;

-- Who stored a Pulse recording, and its storage details. Read past the storage policies, which
-- let a teacher see only their own uploads until a check claims them, so that a check pointing at a
-- file stored by someone else is refused rather than waiting for a file it can never see.
create function private.pulse_audio_object(object_name text)
returns table (owner_id text, metadata jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.owner_id, o.metadata
  from storage.objects as o
  where o.bucket_id = 'pulse-audio' and o.name = object_name
$$;

-- Whether a stored file, by its fingerprint, was already sent for another check, in any school.
create function private.pulse_audio_reused(target_etag text, target_check_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pulse_checks as k
    where k.audio_etag = target_etag and k.id <> target_check_id
  )
$$;

create function private.guard_pulse_absence_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sample record;
begin
  select * into sample from private.pulse_sample_context(new.sample_id);
  if not found then
    raise exception 'This child was not drawn for Pulse.' using errcode = '23503';
  end if;

  if private.is_api_user() then
    new.marked_by := auth.uid();
    new.created_at := now();
    if not coalesce(
      private.class_section_school_id(sample.class_section_id) = any (private.teacher_school_ids()),
      false
    ) then
      raise exception 'Only teachers of the school can mark absences for Pulse.' using errcode = '42501';
    end if;
    if sample.week is null or sample.opens_on > private.today() then
      raise exception 'This child is not due for a check.' using errcode = '42501';
    end if;
    if new.absent_on < sample.opens_on
       or new.absent_on > least(sample.due_on, private.today())
    then
      raise exception 'An absence can be marked only for a day of the child''s week, up to today.'
        using errcode = '23514';
    end if;
    if private.attendance_shows_present(sample.class_section_id, sample.student_id, new.absent_on) then
      raise exception 'The attendance register shows this child as present on that day.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger pulse_absences_guard_write before insert on public.pulse_absences
  for each row execute function private.guard_pulse_absence_write();

-- Whether the child was given the passage or the prompt in an earlier check, in any school.
create function private.pulse_item_seen(
  target_student_id uuid,
  target_item_code text,
  target_prompt_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pulse_checks as k
    where k.student_id = target_student_id
      and (k.item_code = target_item_code or k.prompt_code = target_prompt_code)
  )
$$;

create function private.guard_pulse_check_insert()
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

create trigger pulse_checks_guard_insert before insert on public.pulse_checks
  for each row execute function private.guard_pulse_check_insert();

revoke all on function private.had_guardian_consent_at(uuid, text, timestamptz) from public;
revoke all on function private.pulse_child_enrolled(uuid, uuid, date) from public;
revoke all on function private.attendance_shows_present(uuid, uuid, date) from public;
revoke all on function private.pulse_item_seen(uuid, text, text) from public;
revoke all on function private.pulse_child_eligible(uuid) from public;
revoke all on function private.pulse_week_of(date) from public;
revoke all on function private.pulse_week_end(date, smallint) from public;
revoke all on function private.draw_pulse_cycle(uuid, date, date) from public;
revoke all on function private.replace_pulse_samples(date) from public;
revoke all on function private.run_pulse_schedule(date) from public;
revoke all on function private.pulse_sample_context(uuid) from public;
revoke all on function private.pulse_audio_class_section(text) from public;
revoke all on function private.pulse_audio_sample(text) from public;
revoke all on function private.pulse_audio_upload_allowed(text) from public;
revoke all on function private.pulse_audio_object(text) from public;
revoke all on function private.pulse_audio_reused(text, uuid) from public;
revoke all on function private.guard_pulse_absence_write() from public;
revoke all on function private.guard_pulse_check_insert() from public;

grant execute on function
  private.pulse_week_of(date),
  private.pulse_week_end(date, smallint),
  private.pulse_sample_context(uuid),
  private.pulse_audio_class_section(text),
  private.pulse_audio_sample(text),
  private.pulse_audio_upload_allowed(text),
  private.pulse_audio_object(text),
  private.pulse_audio_reused(text, uuid),
  private.attendance_shows_present(uuid, uuid, date),
  private.pulse_item_seen(uuid, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

alter table public.pulse_cycles enable row level security;
alter table public.pulse_samples enable row level security;
alter table public.pulse_absences enable row level security;
alter table public.pulse_checks enable row level security;
alter table private.pulse_draws enable row level security;
alter table public.pulse_week_batches enable row level security;
alter table public.pulse_week_keys enable row level security;

revoke all on table public.pulse_cycles from anon, authenticated, service_role;
revoke all on table public.pulse_samples from anon, authenticated, service_role;
revoke all on table public.pulse_absences from anon, authenticated, service_role;
revoke all on table public.pulse_checks from anon, authenticated, service_role;
revoke all on table private.pulse_draws from anon, authenticated, service_role;
revoke all on table public.pulse_week_batches from anon, authenticated, service_role;
revoke all on table public.pulse_week_keys from anon, authenticated, service_role;

-- Cycles and samples are written only by the database's own schedule.
grant select on table public.pulse_cycles to authenticated;
grant select on table public.pulse_samples to authenticated;
grant select, insert on table public.pulse_absences to authenticated;
-- Checks are never edited or deleted through the API.
grant select, insert on table public.pulse_checks to authenticated;
grant select on table public.pulse_week_batches to authenticated;
grant select on table public.pulse_week_keys to authenticated;

grant select on table public.pulse_cycles to service_role;
grant select, update on table public.pulse_samples to service_role;
grant select, insert, delete on table public.pulse_absences to service_role;
grant select, insert, update on table public.pulse_checks to service_role;
grant select on table public.pulse_week_batches to service_role;
grant select on table public.pulse_week_keys to service_role;

create policy "Staff can read Pulse cycles of their schools" on public.pulse_cycles
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.class_section_school_id(class_section_id)
       = any ((select private.staff_school_ids())::uuid[])
  );

-- Teachers see a child once the child's week has opened; the CRP and administrators see the whole
-- draw, including the reserve, to follow progress and replacements.
create policy "Staff can read drawn children of their schools" on public.pulse_samples
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.class_section_school_id(class_section_id)
       = any ((select private.crp_school_ids())::uuid[])
    or (
      private.class_section_school_id(class_section_id)
        = any ((select private.teacher_school_ids())::uuid[])
      and week is not null
      and opens_on <= (select private.today())
    )
  );

-- The encrypted weeks: teachers hold the next two weeks; the CRP and administrators all of them.
create policy "Staff can read the encrypted weeks of their schools" on public.pulse_week_batches
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.class_section_school_id(class_section_id)
       = any ((select private.crp_school_ids())::uuid[])
    or (
      private.class_section_school_id(class_section_id)
        = any ((select private.teacher_school_ids())::uuid[])
      and opens_on <= (select private.today()) + 14
    )
  );

-- The keys: teachers receive a week's key when it opens; the CRP holds the keys of the next two
-- weeks, to unlock a week by QR code where there is no network.
create policy "Staff can read the keys of opened weeks" on public.pulse_week_keys
  for select to authenticated
  using (
    (select private.is_super_admin())
    or (
      private.class_section_school_id(class_section_id)
        = any ((select private.crp_school_ids())::uuid[])
      and opens_on <= (select private.today()) + 14
    )
    or (
      private.class_section_school_id(class_section_id)
        = any ((select private.teacher_school_ids())::uuid[])
      and opens_on <= (select private.today())
    )
  );

create policy "Staff can read Pulse absences of their schools" on public.pulse_absences
  for select to authenticated
  using (
    exists (select 1 from public.pulse_samples as s where s.id = pulse_absences.sample_id)
  );
create policy "Teachers can mark drawn children absent" on public.pulse_absences
  for insert to authenticated
  with check (
    exists (
      select 1 from public.pulse_samples as s
      where s.id = pulse_absences.sample_id
        and private.class_section_school_id(s.class_section_id)
            = any ((select private.teacher_school_ids())::uuid[])
    )
  );

create policy "Staff can read Pulse checks of their schools" on public.pulse_checks
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.class_section_school_id(class_section_id)
       = any ((select private.staff_school_ids())::uuid[])
  );
create policy "Teachers can record Pulse checks of their classes" on public.pulse_checks
  for insert to authenticated
  with check (
    exists (
      select 1 from public.pulse_samples as s
      where s.id = pulse_checks.sample_id
        and private.class_section_school_id(s.class_section_id)
            = any ((select private.teacher_school_ids())::uuid[])
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Audio storage
-- ---------------------------------------------------------------------------------------------

-- Private bucket; a minute of speech at the recorder's bit rate is far below the limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pulse-audio', 'pulse-audio', false, 2097152, array['audio/webm', 'audio/ogg', 'audio/mp4'])
on conflict (id) do update
set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Recordings are uploaded only by teachers of the class's school, under the folder of a drawn child
-- who is due and whose family consents. They cannot be replaced or deleted through the API; the
-- retention job removes them after 30 days, and uploads no check claimed after two days.
create policy "Teachers can upload Pulse recordings of their classes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pulse-audio'
    and private.pulse_audio_upload_allowed(name)
  );
-- The school's staff and its CRP listen to recordings a check has claimed; until then only the
-- teacher who uploaded one can see it (the check reads it when it arrives).
create policy "Staff can listen to Pulse recordings of their schools" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pulse-audio'
    and (
      (select private.is_super_admin())
      or (
        private.class_section_school_id(private.pulse_audio_class_section(name))
          = any ((select private.staff_school_ids())::uuid[])
        and (
          owner_id = (select auth.uid())::text
          or exists (select 1 from public.pulse_checks as k where k.audio_path = name)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the Pulse schedule was not created.';
    return;
  end if;

  -- 18:35 UTC is 00:05 IST: the new day's draws and replacements are ready before school starts.
  perform cron.schedule('pulse-daily-schedule', '35 18 * * *', 'select private.run_pulse_schedule()');
end;
$$;

-- The current month's cycles, so that classes do not wait for the first scheduled run.
select private.run_pulse_schedule();
