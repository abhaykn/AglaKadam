-- Daily class attendance, stored as one row per class per day with the list of absent students.
-- The enrolled count is computed by the database from enrolments, never taken from the device.
--
-- Time windows (IST) balance offline use against rewriting history:
--   * a new record may be created for any of the last 31 days, so a teacher who was offline for
--     several weeks loses nothing when the device finally syncs;
--   * an existing record may be corrected for 7 days; older corrections need an administrator.

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  attendance_date date not null,
  absent_student_ids uuid[] not null default '{}',
  enrolled_count smallint not null default 0,
  present_count smallint generated always as (
    (enrolled_count - cardinality(absent_student_ids))::smallint
  ) stored,
  marked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sessions_class_section_date_key unique (class_section_id, attendance_date),
  constraint attendance_sessions_counts_valid check (
    enrolled_count >= 0 and cardinality(absent_student_ids) <= enrolled_count
  )
);

comment on table public.attendance_sessions is
  'Attendance of one class on one day. Students not listed as absent were present.';

create index attendance_sessions_marked_by_idx on public.attendance_sessions (marked_by);
create index attendance_sessions_attendance_date_idx on public.attendance_sessions (attendance_date);

create trigger attendance_sessions_touch_updated_at before update on public.attendance_sessions
  for each row execute function private.touch_updated_at();
create trigger attendance_sessions_keep_identifier before update on public.attendance_sessions
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

-- Students counted for a class on a date: those whose enrolment covers that date. A departure
-- closes the enrolment on the leaving date, so earlier days keep the child on the roll and
-- corrections to past records do not rewrite history.
create function private.attendance_roll(target_class_section_id uuid, target_date date)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(e.student_id), '{}')
  from public.enrolments as e
  where e.class_section_id = target_class_section_id
    and e.enrolled_on <= target_date
    and (e.ended_on is null or e.ended_on >= target_date)
$$;

create function private.class_section_is_active(target_class_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_active from public.class_sections where id = target_class_section_id),
    false
  )
$$;

create function private.guard_attendance_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  roll uuid[];
begin
  if tg_op = 'UPDATE'
     and (new.class_section_id, new.attendance_date, new.created_at)
         is distinct from (old.class_section_id, old.attendance_date, old.created_at)
  then
    raise exception 'The class and date of an attendance record cannot be changed.'
      using errcode = '42501';
  end if;

  if private.is_api_user() then
    new.marked_by := auth.uid();

    if not private.is_super_admin() then
      if new.attendance_date > private.today() then
        raise exception 'Attendance cannot be marked for a future date.' using errcode = '23514';
      end if;
      if tg_op = 'INSERT' and new.attendance_date < private.today() - 31 then
        raise exception 'Attendance older than 31 days can only be added by an administrator.'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and old.attendance_date < private.today() - 7 then
        raise exception 'Attendance older than 7 days can only be corrected by an administrator.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' and not private.class_section_is_active(new.class_section_id) then
    raise exception 'Attendance cannot be marked for an inactive class.' using errcode = '23514';
  end if;

  -- A teacher saving the record always refreshes the counts (for example after a late admission).
  -- System updates that leave the absences untouched, such as clearing `marked_by` when an account
  -- is removed, keep the counts as they were.
  if tg_op = 'UPDATE' and not private.is_api_user()
     and new.absent_student_ids is not distinct from old.absent_student_ids
  then
    new.enrolled_count := old.enrolled_count;
    return new;
  end if;

  roll := private.attendance_roll(new.class_section_id, new.attendance_date);

  -- Keep only students on the class roll for that date. A device that was offline may still list a
  -- record that was removed meanwhile (for example a duplicate entry); rejecting the whole day would
  -- leave that attendance unsyncable, while ignoring the stale entry keeps the counts correct.
  new.absent_student_ids := coalesce(
    (select array_agg(distinct absent_id order by absent_id)
     from unnest(new.absent_student_ids) as absent_id
     where absent_id = any (roll)),
    '{}'
  );

  new.enrolled_count := cardinality(roll);
  return new;
end;
$$;

create trigger attendance_sessions_guard_write before insert or update on public.attendance_sessions
  for each row execute function private.guard_attendance_write();

revoke all on function private.attendance_roll(uuid, date) from public;
revoke all on function private.class_section_is_active(uuid) from public;
revoke all on function private.guard_attendance_write() from public;

grant execute on function
  private.attendance_roll(uuid, date),
  private.class_section_is_active(uuid)
  to authenticated, service_role;

alter table public.attendance_sessions enable row level security;

revoke all on table public.attendance_sessions from anon, authenticated, service_role;

-- Records are corrected, never deleted, through the API.
grant select, insert, update on table public.attendance_sessions to authenticated;
grant select, insert, update, delete on table public.attendance_sessions to service_role;

create policy "Staff can read attendance in their schools" on public.attendance_sessions
  for select to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = attendance_sessions.class_section_id
        and cs.school_id = any ((select private.staff_school_ids())::uuid[])
    )
  );
create policy "Teachers can mark attendance in their school" on public.attendance_sessions
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = attendance_sessions.class_section_id
        and cs.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  );
create policy "Teachers can correct attendance in their school" on public.attendance_sessions
  for update to authenticated
  using (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = attendance_sessions.class_section_id
        and cs.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  )
  with check (
    (select private.is_super_admin())
    or exists (
      select 1 from public.class_sections as cs
      where cs.id = attendance_sessions.class_section_id
        and cs.school_id = any ((select private.teacher_school_ids())::uuid[])
    )
  );
