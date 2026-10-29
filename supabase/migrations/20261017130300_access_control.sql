-- Access control helpers and the policies for organisation and account tables.
--
-- Visibility rules:
--   * super_admin                 everything.
--   * district_officer / block_officer
--                                 geography and school names in scope; no individual records.
--                                 Their reports come from aggregate functions added later.
--   * crp                         schools of the assigned clusters, their teachers and classes.
--   * teacher                     the assigned school, its classes and colleagues, and the CRP of
--                                 that cluster.
--   * student                     added by the academics migration.
--
-- Helpers return arrays so that a policy can evaluate them once per statement by wrapping the call
-- in a scalar sub-select. The cast matters: `= any ((select private.staff_school_ids())::uuid[])`
-- compares against the array, whereas without it Postgres reads the sub-select as a row source.

-- Assignments of the signed-in user that are active today.
create function private.active_assignments()
returns setof public.staff_assignments
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.staff_assignments as a
  join public.profiles as p on p.id = a.user_id
  where a.user_id = auth.uid()
    and p.is_active
    and a.starts_on <= private.today()
    and (a.ends_on is null or a.ends_on >= private.today())
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.active_assignments())
$$;

create function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.active_assignments() where role = 'super_admin')
$$;

create function private.teacher_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct school_id), '{}')
  from private.active_assignments()
  where role = 'teacher'
$$;

create function private.crp_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}')
  from public.schools as s
  where s.cluster_id in (select cluster_id from private.active_assignments() where role = 'crp')
$$;

-- Schools whose operational records (classes, students, attendance) the user works with.
create function private.staff_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.teacher_school_ids() || private.crp_school_ids()
$$;

-- Schools inside the district or block of an education officer.
create function private.officer_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}')
  from public.schools as s
  join public.clusters as c on c.id = s.cluster_id
  join public.blocks as b on b.id = c.block_id
  where b.id in (select block_id from private.active_assignments() where role = 'block_officer')
     or b.district_id in (
       select district_id from private.active_assignments() where role = 'district_officer'
     )
$$;

-- Schools whose name and code the user may see.
create function private.readable_school_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.staff_school_ids() || private.officer_school_ids()
$$;

-- Staff whose profile the user may see: colleagues at the same school, the teachers of a CRP's
-- schools, the CRPs of a teacher's cluster, fellow CRPs of a cluster, and the CRPs supervised by an
-- education officer.
create function private.visible_profile_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select * from private.active_assignments()
  ),
  my_schools as (
    select private.staff_school_ids() as ids
  ),
  teacher_clusters as (
    select s.cluster_id
    from public.schools as s
    where s.id in (select school_id from mine where role = 'teacher')
  ),
  officer_clusters as (
    select c.id
    from public.clusters as c
    join public.blocks as b on b.id = c.block_id
    where c.block_id in (select block_id from mine where role = 'block_officer')
       or b.district_id in (select district_id from mine where role = 'district_officer')
  )
  select coalesce(array_agg(distinct a.user_id), '{}')
  from public.staff_assignments as a
  where a.starts_on <= private.today()
    and (a.ends_on is null or a.ends_on >= private.today())
    and (
      (a.role = 'teacher' and a.school_id = any ((select ids from my_schools)::uuid[]))
      or (a.role = 'crp' and a.cluster_id in (select cluster_id from teacher_clusters))
      or (a.role = 'crp' and a.cluster_id in (select cluster_id from mine where role = 'crp'))
      or (a.role = 'crp' and a.cluster_id in (select id from officer_clusters))
    )
$$;

-- True when another open super administrator assignment, held by an active account, exists.
create function private.other_super_admin_exists(excluded_user_id uuid, excluded_assignment_id uuid)
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
    where a.role = 'super_admin'
      and a.starts_on <= private.today()
      and a.ends_on is null
      and p.is_active
      and a.user_id is distinct from excluded_user_id
      and a.id is distinct from excluded_assignment_id
  )
$$;

-- Serialises every change that could remove a super administrator, so two administrators cannot
-- remove each other concurrently and leave none behind.
create function private.lock_super_admin_continuity()
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('agla_kadam.super_admin_continuity', 0))
$$;

create function private.holds_open_super_admin_assignment(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_assignments
    where user_id = target_user_id and role = 'super_admin' and ends_on is null
  )
$$;

-- Column rules for profile updates, which row level security cannot express.
create function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.account_kind is distinct from old.account_kind then
    raise exception 'The identity of an account cannot be changed.'
      using errcode = '42501';
  end if;

  if private.is_api_user() and not private.is_super_admin()
     and (new.full_name is distinct from old.full_name or new.is_active is distinct from old.is_active)
  then
    raise exception 'Only an administrator can change the name or status of an account.'
      using errcode = '42501';
  end if;

  if old.is_active and not new.is_active and private.holds_open_super_admin_assignment(new.id) then
    perform private.lock_super_admin_continuity();
    if not private.other_super_admin_exists(new.id, null) then
      raise exception 'The last active super administrator cannot be deactivated.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update before update on public.profiles
  for each row execute function private.guard_profile_update();

-- Assignments are append-only apart from their end date, and the last super administrator cannot
-- be removed.
create function private.guard_staff_assignment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if private.is_api_user() then
      new.created_by := auth.uid();
    end if;
    return new;
  end if;

  -- `created_by` may only be cleared, which the foreign key does when that account is removed.
  if tg_op = 'UPDATE'
     and (
       (new.user_id, new.role, new.district_id, new.block_id, new.cluster_id, new.school_id,
        new.starts_on, new.created_at)
       is distinct from
       (old.user_id, old.role, old.district_id, old.block_id, old.cluster_id, old.school_id,
        old.starts_on, old.created_at)
       or (new.created_by is distinct from old.created_by and new.created_by is not null)
     )
  then
    raise exception 'Only the end date of an assignment can change. End it and create a new one instead.'
      using errcode = '42501';
  end if;

  if old.role = 'super_admin' and old.ends_on is null
     and (tg_op = 'DELETE' or new.ends_on is not null)
  then
    perform private.lock_super_admin_continuity();
    if not private.other_super_admin_exists(null, old.id) then
      raise exception 'The last active super administrator assignment cannot be ended.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger staff_assignments_guard_write before insert or update or delete
  on public.staff_assignments
  for each row execute function private.guard_staff_assignment_write();

revoke all on function private.active_assignments() from public;
revoke all on function private.is_staff() from public;
revoke all on function private.is_super_admin() from public;
revoke all on function private.teacher_school_ids() from public;
revoke all on function private.crp_school_ids() from public;
revoke all on function private.staff_school_ids() from public;
revoke all on function private.officer_school_ids() from public;
revoke all on function private.readable_school_ids() from public;
revoke all on function private.visible_profile_ids() from public;
revoke all on function private.other_super_admin_exists(uuid, uuid) from public;
revoke all on function private.holds_open_super_admin_assignment(uuid) from public;
revoke all on function private.lock_super_admin_continuity() from public;
revoke all on function private.guard_profile_update() from public;
revoke all on function private.guard_staff_assignment_write() from public;

grant execute on function
  private.active_assignments(),
  private.is_staff(),
  private.is_super_admin(),
  private.teacher_school_ids(),
  private.crp_school_ids(),
  private.staff_school_ids(),
  private.officer_school_ids(),
  private.readable_school_ids(),
  private.visible_profile_ids(),
  private.other_super_admin_exists(uuid, uuid),
  private.holds_open_super_admin_assignment(uuid),
  private.lock_super_admin_continuity()
  to authenticated, service_role;

-- Geography: readable by active staff, managed by super administrators.
create policy "Staff can read states" on public.states
  for select to authenticated using ((select private.is_staff()));
create policy "Super administrators can add states" on public.states
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can edit states" on public.states
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy "Super administrators can remove states" on public.states
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Staff can read districts" on public.districts
  for select to authenticated using ((select private.is_staff()));
create policy "Super administrators can add districts" on public.districts
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can edit districts" on public.districts
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy "Super administrators can remove districts" on public.districts
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Staff can read blocks" on public.blocks
  for select to authenticated using ((select private.is_staff()));
create policy "Super administrators can add blocks" on public.blocks
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can edit blocks" on public.blocks
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy "Super administrators can remove blocks" on public.blocks
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Staff can read clusters" on public.clusters
  for select to authenticated using ((select private.is_staff()));
create policy "Super administrators can add clusters" on public.clusters
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can edit clusters" on public.clusters
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy "Super administrators can remove clusters" on public.clusters
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Users can read schools in their scope" on public.schools
  for select to authenticated
  using ((select private.is_super_admin()) or id = any ((select private.readable_school_ids())::uuid[]));
create policy "Super administrators can add schools" on public.schools
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can edit schools" on public.schools
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy "Super administrators can remove schools" on public.schools
  for delete to authenticated using ((select private.is_super_admin()));

-- Profiles.
create policy "Users can read their own and related profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or id = any ((select private.visible_profile_ids())::uuid[])
  );
create policy "Users can update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_super_admin()))
  with check (id = (select auth.uid()) or (select private.is_super_admin()));

-- Staff assignments.
create policy "Users can read their own and related current assignments" on public.staff_assignments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_super_admin())
    or (
      user_id = any ((select private.visible_profile_ids())::uuid[])
      and starts_on <= (select private.today())
      and (ends_on is null or ends_on >= (select private.today()))
    )
  );
create policy "Super administrators can create assignments" on public.staff_assignments
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super administrators can end assignments" on public.staff_assignments
  for update to authenticated
  using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
