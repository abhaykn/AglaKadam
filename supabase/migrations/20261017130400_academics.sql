-- Academic structure: academic years, class sections, class teachers, students, guardian contacts,
-- enrolments and guardian consent.
--
-- Integrity rules that protect the random learning checks from selective reporting:
--   * A student added by a teacher stays `pending` until the cluster resource person (CRP) verifies
--     the record. Only verified (`active`) students can later be drawn for checks.
--   * Only the CRP or an administrator can mark a student as having left, or change the identity
--     details or special needs flag of a verified student, so a teacher cannot quietly remove a
--     child from the pool or swap one child's record for another's.
--   * Teachers enrol students from a recent date with no end date; back-dated, future-dated and
--     closed enrolments need the CRP.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_years_label_key unique (label),
  constraint academic_years_label_format check (label ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint academic_years_period_valid check (ends_on > starts_on)
);

comment on table public.academic_years is 'Academic sessions, for example 2026-27 (April to March).';

create table public.class_sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  grade smallint not null,
  section text not null default 'A',
  medium text not null default 'hi',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_sections_school_year_grade_section_key
    unique (school_id, academic_year_id, grade, section),
  constraint class_sections_grade_range check (grade between 0 and 8),
  constraint class_sections_section_format check (section ~ '^[A-Z0-9]{1,3}$'),
  constraint class_sections_medium_valid check (medium in ('hi', 'en'))
);

comment on column public.class_sections.grade is 'Grade 0 is Balvatika, the preparatory year before Grade 1.';

create index class_sections_academic_year_id_idx on public.class_sections (academic_year_id);

create table public.class_teachers (
  class_section_id uuid not null references public.class_sections (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (class_section_id, teacher_id)
);

create index class_teachers_teacher_id_idx on public.class_teachers (teacher_id);
create unique index class_teachers_one_primary_per_section
  on public.class_teachers (class_section_id) where is_primary;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete restrict,
  student_code text not null,
  admission_number text,
  full_name text not null,
  gender text not null,
  date_of_birth date,
  has_special_needs boolean not null default false,
  status text not null default 'pending',
  left_on date,
  left_reason text,
  auth_user_id uuid references auth.users (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_student_code_key unique (student_code),
  constraint students_auth_user_id_key unique (auth_user_id),
  constraint students_school_admission_number_key unique (school_id, admission_number),
  constraint students_student_code_format check (student_code ~ '^[1-9][0-9]{9}$'),
  constraint students_admission_number_length check (
    admission_number is null or char_length(btrim(admission_number)) between 1 and 30
  ),
  constraint students_full_name_length check (char_length(btrim(full_name)) between 1 and 120),
  constraint students_gender_valid check (gender in ('female', 'male', 'transgender')),
  constraint students_date_of_birth_plausible check (
    date_of_birth is null or date_of_birth >= date '2005-01-01'
  ),
  constraint students_status_valid check (status in ('pending', 'active', 'left')),
  constraint students_left_reason_valid check (
    left_reason is null
    or left_reason in ('transferred', 'migrated', 'dropped_out', 'duplicate_record', 'other')
  ),
  constraint students_left_details check (
    (status = 'left' and left_on is not null and left_reason is not null)
    or (status <> 'left' and left_on is null and left_reason is null)
  )
);

comment on table public.students is 'Learners. Personal details are kept to the minimum the platform needs.';
comment on column public.students.student_code is
  'System-assigned 10-digit learner code with a Luhn check digit, used for the family portal.';
comment on column public.students.has_special_needs is
  'Child with special needs; such children receive an adapted, teacher-observed check.';
comment on column public.students.status is
  'pending: added by a teacher and awaiting CRP verification. active: verified. left: no longer enrolled.';

create index students_created_by_idx on public.students (created_by);
create index students_verified_by_idx on public.students (verified_by);

-- Guardian details are separated from the student record so that only the school's teachers, not
-- the cluster resource person, can read them.
create table public.student_contacts (
  student_id uuid primary key references public.students (id) on delete cascade,
  guardian_name text not null,
  relationship text not null,
  guardian_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_contacts_guardian_name_length check (
    char_length(btrim(guardian_name)) between 1 and 120
  ),
  constraint student_contacts_relationship_valid check (
    relationship in ('mother', 'father', 'guardian')
  ),
  constraint student_contacts_guardian_phone_format check (
    guardian_phone is null or guardian_phone ~ '^[6-9][0-9]{9}$'
  )
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  roll_number smallint,
  enrolled_on date not null default private.today(),
  ended_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enrolments_student_class_section_key unique (student_id, class_section_id),
  constraint enrolments_period_valid check (ended_on is null or ended_on >= enrolled_on),
  constraint enrolments_roll_number_range check (roll_number is null or roll_number between 1 and 999)
);

comment on table public.enrolments is
  'Membership of a student in a class section. A student has at most one open enrolment.';

create unique index enrolments_one_open_per_student
  on public.enrolments (student_id) where ended_on is null;
create index enrolments_class_section_id_idx on public.enrolments (class_section_id);
create index enrolments_created_by_idx on public.enrolments (created_by);

-- Consent decisions are append-only: the most recent record for a purpose is the one in force.
create table public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: a student with consent records cannot be deleted through the API, so a recorded
  -- decision cannot disappear as a side effect. Erasure requests remove these rows explicitly.
  student_id uuid not null references public.students (id) on delete restrict,
  purpose text not null,
  granted boolean not null,
  guardian_name text not null,
  method text not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint guardian_consents_purpose_valid check (purpose in ('audio_assessment')),
  constraint guardian_consents_guardian_name_length check (
    char_length(btrim(guardian_name)) between 1 and 120
  ),
  constraint guardian_consents_method_valid check (method in ('paper_form', 'in_person', 'digital'))
);

comment on table public.guardian_consents is
  'Parental consent records required by the Digital Personal Data Protection Act, 2023.';
comment on column public.guardian_consents.purpose is
  'audio_assessment: recording the child''s voice for a learning check.';

create index guardian_consents_student_purpose_idx
  on public.guardian_consents (student_id, purpose, recorded_at desc);
create index guardian_consents_recorded_by_idx on public.guardian_consents (recorded_by);

create trigger academic_years_touch_updated_at before update on public.academic_years
  for each row execute function private.touch_updated_at();
create trigger class_sections_touch_updated_at before update on public.class_sections
  for each row execute function private.touch_updated_at();
create trigger students_touch_updated_at before update on public.students
  for each row execute function private.touch_updated_at();
create trigger student_contacts_touch_updated_at before update on public.student_contacts
  for each row execute function private.touch_updated_at();
create trigger enrolments_touch_updated_at before update on public.enrolments
  for each row execute function private.touch_updated_at();

create trigger academic_years_keep_identifier before update on public.academic_years
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger class_sections_keep_identifier before update on public.class_sections
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger students_keep_identifier before update on public.students
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger student_contacts_keep_identifier before update on public.student_contacts
  for each row when (new.student_id is distinct from old.student_id)
  execute function private.keep_identifier();
create trigger enrolments_keep_identifier before update on public.enrolments
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Student record linked to the signed-in family account, if the record is active.
create function private.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.students as s
  join public.profiles as p on p.id = s.auth_user_id
  where s.auth_user_id = auth.uid()
    and s.status = 'active'
    and p.is_active
$$;

create function private.student_class_section_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(e.class_section_id), '{}')
  from public.enrolments as e
  where e.student_id = private.current_student_id()
    and e.ended_on is null
$$;

-- Schools whose name and code the user may see, now including a family account's own school.
create or replace function private.readable_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.staff_school_ids()
    || private.officer_school_ids()
    || coalesce(
      (select array_agg(s.school_id) from public.students as s
       where s.id = private.current_student_id()),
      '{}'
    )
$$;

create function private.class_section_school_id(target_class_section_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select school_id from public.class_sections where id = target_class_section_id
$$;

create function private.student_school_id(target_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select school_id from public.students where id = target_student_id
$$;

-- Whether the most recent consent decision for a purpose is a grant.
create function private.has_guardian_consent(target_student_id uuid, consent_purpose text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.granted
     from public.guardian_consents as c
     where c.student_id = target_student_id and c.purpose = consent_purpose
     order by c.recorded_at desc
     limit 1),
    false
  )
$$;

-- Check digit of the Luhn algorithm for a string of decimal digits.
create function private.luhn_check_digit(payload text)
returns smallint
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  total integer := 0;
  digit integer;
  position_from_right integer;
begin
  if payload !~ '^[0-9]+$' then
    raise exception 'A Luhn payload must contain decimal digits only.' using errcode = '22023';
  end if;

  -- The check digit is appended on the right, so doubling starts with the rightmost payload digit.
  for position_from_right in 1 .. char_length(payload) loop
    digit := substr(payload, char_length(payload) - position_from_right + 1, 1)::integer;
    if position_from_right % 2 = 1 then
      digit := digit * 2;
      if digit > 9 then
        digit := digit - 9;
      end if;
    end if;
    total := total + digit;
  end loop;

  return ((10 - total % 10) % 10)::smallint;
end;
$$;

-- New learner code: nine random digits (the first non-zero) followed by a Luhn check digit.
create function private.generate_student_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  random_bytes bytea;
  payload text;
  candidate text;
begin
  loop
    random_bytes := extensions.gen_random_bytes(9);
    payload := (1 + get_byte(random_bytes, 0) % 9)::text;
    for byte_index in 1 .. 8 loop
      payload := payload || (get_byte(random_bytes, byte_index) % 10)::text;
    end loop;
    candidate := payload || private.luhn_check_digit(payload)::text;
    exit when not exists (select 1 from public.students where student_code = candidate);
  end loop;
  return candidate;
end;
$$;

-- Facts needed to validate an enrolment, read regardless of the caller's visibility.
create function private.enrolment_context(target_student_id uuid, target_class_section_id uuid)
returns table (
  student_school_id uuid,
  student_status text,
  section_school_id uuid,
  section_is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.school_id, s.status, cs.school_id, cs.is_active
  from public.students as s
  cross join public.class_sections as cs
  where s.id = target_student_id and cs.id = target_class_section_id
$$;

-- Whether the account holds an active teacher assignment at the school.
create function private.is_teacher_at(target_user_id uuid, target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_assignments as a
    join public.profiles as p on p.id = a.user_id
    where a.user_id = target_user_id
      and a.role = 'teacher'
      and a.school_id = target_school_id
      and p.is_active
      and a.starts_on <= private.today()
      and (a.ends_on is null or a.ends_on >= private.today())
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------

create function private.guard_academic_year_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.academic_years as y
    where y.id <> new.id
      and daterange(y.starts_on, y.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')
  ) then
    raise exception 'Academic years cannot overlap.' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger academic_years_guard_write before insert or update on public.academic_years
  for each row execute function private.guard_academic_year_write();

create function private.guard_class_section_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_user() and not private.is_super_admin()
     and (new.school_id, new.academic_year_id, new.grade, new.section, new.created_at)
         is distinct from
         (old.school_id, old.academic_year_id, old.grade, old.section, old.created_at)
  then
    raise exception 'Only the medium and active status of a class can be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger class_sections_guard_update before update on public.class_sections
  for each row execute function private.guard_class_section_update();

create function private.guard_class_teacher_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.class_section_id, new.teacher_id) is distinct from (old.class_section_id, old.teacher_id)
  then
    raise exception 'A class teacher record cannot be moved. Remove it and add a new one.'
      using errcode = '42501';
  end if;

  if not private.is_teacher_at(new.teacher_id, private.class_section_school_id(new.class_section_id))
  then
    raise exception 'The teacher must be assigned to the school of this class.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger class_teachers_guard_write before insert or update on public.class_teachers
  for each row execute function private.guard_class_teacher_write();

create function private.guard_student_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  api_user constant boolean := private.is_api_user();
  caller_is_admin boolean := false;
  caller_is_cluster_crp boolean := false;
begin
  if api_user then
    caller_is_admin := private.is_super_admin();
    caller_is_cluster_crp :=
      (case when tg_op = 'INSERT' then new.school_id else old.school_id end)
        = any (private.crp_school_ids());
  end if;

  if tg_op = 'INSERT' then
    if api_user or new.student_code is null then
      new.student_code := private.generate_student_code();
    end if;
    if api_user then
      new.auth_user_id := null;
      new.created_by := auth.uid();
      new.verified_by := null;
      new.verified_at := null;
      if not caller_is_admin and not caller_is_cluster_crp and new.status <> 'pending' then
        raise exception 'Students added by a teacher stay pending until the cluster resource person verifies them.'
          using errcode = '42501';
      end if;
    end if;
  else
    if api_user then
      new.created_by := old.created_by;
    end if;

    -- `created_by` may only be cleared, which the foreign key does when that account is removed.
    if new.student_code is distinct from old.student_code
       or new.created_at is distinct from old.created_at
       or (new.created_by is distinct from old.created_by and new.created_by is not null)
    then
      raise exception 'System-managed student details cannot be changed.' using errcode = '42501';
    end if;

    if new.status = 'pending' and old.status <> 'pending' then
      raise exception 'A verified or departed student cannot return to pending.' using errcode = '23514';
    end if;

    if api_user then
      new.verified_by := old.verified_by;
      new.verified_at := old.verified_at;

      if new.auth_user_id is distinct from old.auth_user_id then
        raise exception 'Family sign-in accounts are managed by the provisioning service.'
          using errcode = '42501';
      end if;

      if new.school_id is distinct from old.school_id and not caller_is_admin then
        raise exception 'Only an administrator can move a student to another school.'
          using errcode = '42501';
      end if;

      if not caller_is_admin and not caller_is_cluster_crp then
        if new.status is distinct from old.status
           or new.left_on is distinct from old.left_on
           or new.left_reason is distinct from old.left_reason
        then
          raise exception 'Only the cluster resource person can change whether a student is enrolled.'
            using errcode = '42501';
        end if;
        if old.status <> 'pending'
           and (new.full_name, new.gender, new.date_of_birth, new.admission_number,
                new.has_special_needs)
               is distinct from
               (old.full_name, old.gender, old.date_of_birth, old.admission_number,
                old.has_special_needs)
        then
          raise exception 'Only the cluster resource person can change the details of a verified student.'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  if new.date_of_birth is not null and new.date_of_birth > private.today() then
    raise exception 'Date of birth cannot be in the future.' using errcode = '23514';
  end if;

  if new.status <> 'left' then
    new.left_on := null;
    new.left_reason := null;
  end if;

  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    if api_user then
      new.verified_by := auth.uid();
    end if;
    new.verified_at := now();
  end if;

  return new;
end;
$$;

create trigger students_guard_write before insert or update on public.students
  for each row execute function private.guard_student_write();

-- A departure or a move to another school closes the student's open enrolment.
create function private.close_enrolments_of_departed_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'left' and old.status <> 'left' then
    update public.enrolments
    set ended_on = greatest(new.left_on, enrolled_on)
    where student_id = new.id and ended_on is null;
  elsif new.school_id <> old.school_id then
    update public.enrolments
    set ended_on = greatest(private.today(), enrolled_on)
    where student_id = new.id and ended_on is null;
  end if;
  return null;
end;
$$;

create trigger students_close_enrolments after update of status, school_id on public.students
  for each row execute function private.close_enrolments_of_departed_student();

create function private.guard_enrolment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  api_user constant boolean := private.is_api_user();
  context record;
  caller_is_admin_or_crp boolean := false;
begin
  if tg_op = 'UPDATE' then
    if api_user then
      new.created_by := old.created_by;
    end if;
    -- `created_by` may only be cleared, which the foreign key does when that account is removed.
    if (new.student_id, new.class_section_id, new.created_at)
       is distinct from (old.student_id, old.class_section_id, old.created_at)
       or (new.created_by is distinct from old.created_by and new.created_by is not null)
    then
      raise exception 'An enrolment cannot be moved. End it and enrol the student in the new class instead.'
        using errcode = '42501';
    end if;
  end if;

  select * into context from private.enrolment_context(new.student_id, new.class_section_id);

  if api_user then
    caller_is_admin_or_crp :=
      private.is_super_admin() or context.section_school_id = any (private.crp_school_ids());
  end if;

  if tg_op = 'INSERT' then
    -- Checked on creation only: when an administrator moves a student to another school, the
    -- student's old enrolment is closed after the move and must remain editable.
    if context.student_school_id is distinct from context.section_school_id then
      raise exception 'A student can only be enrolled in a class of their own school.'
        using errcode = '23514';
    end if;
    if context.student_status not in ('pending', 'active') then
      raise exception 'A student who has left cannot be enrolled.' using errcode = '23514';
    end if;
    if not context.section_is_active then
      raise exception 'Students cannot be enrolled in an inactive class.' using errcode = '23514';
    end if;
    if api_user then
      new.created_by := auth.uid();
      if not caller_is_admin_or_crp
         and (new.ended_on is not null
              or new.enrolled_on > private.today()
              or new.enrolled_on < private.today() - 31)
      then
        raise exception 'Teachers enrol students from a date within the last 31 days, with no end date. Ask the cluster resource person for other changes.'
          using errcode = '42501';
      end if;
    end if;
  elsif api_user
        and not caller_is_admin_or_crp
        and (new.enrolled_on, new.ended_on) is distinct from (old.enrolled_on, old.ended_on)
  then
    raise exception 'Only the cluster resource person can change enrolment dates.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger enrolments_guard_write before insert or update on public.enrolments
  for each row execute function private.guard_enrolment_write();

create function private.stamp_guardian_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_user() then
    new.recorded_by := auth.uid();
    new.recorded_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger guardian_consents_stamp before insert on public.guardian_consents
  for each row execute function private.stamp_guardian_consent();

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on function private.current_student_id() from public;
revoke all on function private.student_class_section_ids() from public;
revoke all on function private.class_section_school_id(uuid) from public;
revoke all on function private.student_school_id(uuid) from public;
revoke all on function private.has_guardian_consent(uuid, text) from public;
revoke all on function private.luhn_check_digit(text) from public;
revoke all on function private.generate_student_code() from public;
revoke all on function private.enrolment_context(uuid, uuid) from public;
revoke all on function private.is_teacher_at(uuid, uuid) from public;
revoke all on function private.guard_academic_year_write() from public;
revoke all on function private.guard_class_section_update() from public;
revoke all on function private.guard_class_teacher_write() from public;
revoke all on function private.guard_student_write() from public;
revoke all on function private.close_enrolments_of_departed_student() from public;
revoke all on function private.guard_enrolment_write() from public;
revoke all on function private.stamp_guardian_consent() from public;

grant execute on function
  private.current_student_id(),
  private.student_class_section_ids(),
  private.class_section_school_id(uuid),
  private.student_school_id(uuid),
  private.has_guardian_consent(uuid, text),
  private.luhn_check_digit(text),
  private.generate_student_code(),
  private.enrolment_context(uuid, uuid),
  private.is_teacher_at(uuid, uuid)
  to authenticated, service_role;

alter table public.academic_years enable row level security;
alter table public.class_sections enable row level security;
alter table public.class_teachers enable row level security;
alter table public.students enable row level security;
alter table public.student_contacts enable row level security;
alter table public.enrolments enable row level security;
alter table public.guardian_consents enable row level security;

revoke all on table
  public.academic_years,
  public.class_sections,
  public.class_teachers,
  public.students,
  public.student_contacts,
  public.enrolments,
  public.guardian_consents
  from anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.academic_years,
  public.class_sections,
  public.class_teachers,
  public.students,
  public.student_contacts,
  public.enrolments
  to authenticated, service_role;

-- Consent records can be added but never edited; the service role may delete them only to honour
-- an erasure request.
grant select, insert on table public.guardian_consents to authenticated;
grant select, insert, delete on table public.guardian_consents to service_role;

-- ---------------------------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------------------------

create policy "Signed-in users can read academic years" on public.academic_years
  for select to authenticated using (true);
create policy "Super administrators can add academic years" on public.academic_years
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can edit academic years" on public.academic_years
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy "Super administrators can remove academic years" on public.academic_years
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Users can read classes in their scope" on public.class_sections
  for select to authenticated
  using (
    (select private.is_super_admin())
    or school_id = any ((select private.staff_school_ids())::uuid[])
    or id = any ((select private.student_class_section_ids())::uuid[])
  );
create policy "CRPs and administrators can add classes" on public.class_sections
  for insert to authenticated
  with check (
    (select private.is_super_admin()) or school_id = any ((select private.crp_school_ids())::uuid[])
  );
create policy "CRPs and administrators can edit classes" on public.class_sections
  for update to authenticated
  using ((select private.is_super_admin()) or school_id = any ((select private.crp_school_ids())::uuid[]))
  with check (
    (select private.is_super_admin()) or school_id = any ((select private.crp_school_ids())::uuid[])
  );
create policy "Super administrators can remove classes" on public.class_sections
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Staff can read class teachers in their schools" on public.class_teachers
  for select to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = class_teachers.class_section_id
        and cs.school_id = any ((select private.staff_school_ids())::uuid[])
    )
  );
create policy "CRPs and administrators can assign class teachers" on public.class_teachers
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = class_teachers.class_section_id
        and cs.school_id = any ((select private.crp_school_ids())::uuid[])
    )
  );
create policy "CRPs and administrators can edit class teachers" on public.class_teachers
  for update to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = class_teachers.class_section_id
        and cs.school_id = any ((select private.crp_school_ids())::uuid[])
    )
  )
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = class_teachers.class_section_id
        and cs.school_id = any ((select private.crp_school_ids())::uuid[])
    )
  );
create policy "CRPs and administrators can remove class teachers" on public.class_teachers
  for delete to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = class_teachers.class_section_id
        and cs.school_id = any ((select private.crp_school_ids())::uuid[])
    )
  );

create policy "Users can read students in their scope" on public.students
  for select to authenticated
  using (
    (select private.is_super_admin())
    or school_id = any ((select private.staff_school_ids())::uuid[])
    or id = (select private.current_student_id())
  );
create policy "Staff can add students to their schools" on public.students
  for insert to authenticated
  with check (
    (select private.is_super_admin()) or school_id = any ((select private.staff_school_ids())::uuid[])
  );
create policy "Staff can edit students of their schools" on public.students
  for update to authenticated
  using ((select private.is_super_admin()) or school_id = any ((select private.staff_school_ids())::uuid[]))
  with check (
    (select private.is_super_admin()) or school_id = any ((select private.staff_school_ids())::uuid[])
  );
create policy "Unverified students can be removed by their creator or CRP" on public.students
  for delete to authenticated
  using (
    (select private.is_super_admin())
    or (
      status = 'pending'
      and (
        school_id = any ((select private.crp_school_ids())::uuid[])
        or (
          created_by = (select auth.uid())
          and school_id = any ((select private.teacher_school_ids())::uuid[])
        )
      )
    )
  );

create policy "Teachers and the family can read guardian details" on public.student_contacts
  for select to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.students as s
      where s.id = student_contacts.student_id
        and s.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
    or student_id = (select private.current_student_id())
  );
create policy "Teachers can add guardian details" on public.student_contacts
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.students as s
      where s.id = student_contacts.student_id
        and s.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  );
create policy "Teachers can edit guardian details" on public.student_contacts
  for update to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.students as s
      where s.id = student_contacts.student_id
        and s.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  )
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.students as s
      where s.id = student_contacts.student_id
        and s.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  );
create policy "Super administrators can remove guardian details" on public.student_contacts
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Users can read enrolments in their scope" on public.enrolments
  for select to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = enrolments.class_section_id
        and cs.school_id = any ((select private.staff_school_ids())::uuid[])
    )
    or student_id = (select private.current_student_id())
  );
create policy "Staff can enrol students in their schools" on public.enrolments
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = enrolments.class_section_id
        and cs.school_id = any ((select private.staff_school_ids())::uuid[])
    )
  );
create policy "Staff can edit enrolments in their schools" on public.enrolments
  for update to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = enrolments.class_section_id
        and cs.school_id = any ((select private.staff_school_ids())::uuid[])
    )
  )
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = enrolments.class_section_id
        and cs.school_id = any ((select private.staff_school_ids())::uuid[])
    )
  );
create policy "Super administrators can remove enrolments" on public.enrolments
  for delete to authenticated using ((select private.is_super_admin()));

-- Consent records name the guardian, so like guardian contacts they are limited to the school's
-- teachers, administrators and the family itself.
create policy "Teachers and the family can read consent records" on public.guardian_consents
  for select to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.students as s
      where s.id = guardian_consents.student_id
        and s.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
    or student_id = (select private.current_student_id())
  );
create policy "Teachers can record consent for students of their school" on public.guardian_consents
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.students as s
      where s.id = guardian_consents.student_id
        and s.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  );
