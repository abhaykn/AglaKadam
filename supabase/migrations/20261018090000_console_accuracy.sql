-- Accuracy of the administration console and the CRP home page.
--
-- * Withdrawing a family sign-in keeps the link between the learner and the family account, so that
--   a new slip can reuse the account, but switches the account off. The console showed and counted
--   the link; it now shows and counts whether the account is switched on.
-- * Teachers whose accounts are switched off are no longer counted on the CRP home page.

-- ---------------------------------------------------------------------------------------------
-- Family sign-in state of a learner
-- ---------------------------------------------------------------------------------------------

-- Family accounts are not visible to staff through row-level security, so the state is read by a
-- private helper that checks itself that the caller may see the learner.
create function private.family_sign_in_active(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students as st
    join public.profiles as p on p.id = st.auth_user_id
    where st.id = target_student_id
      and p.is_active
      and (
        private.is_super_admin()
        or st.school_id = any (private.staff_school_ids())
        or st.id = private.current_student_id()
      )
  )
$$;

revoke all on function private.family_sign_in_active(uuid) from public;
grant execute on function private.family_sign_in_active(uuid) to authenticated, service_role;

-- Read as a computed column: students?select=...,family_sign_in_active
create function public.family_sign_in_active(student public.students)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.family_sign_in_active(student.id)
$$;

comment on function public.family_sign_in_active(public.students) is
  'Whether the learner''s family can sign in: a family account exists and is switched on.';

revoke all on function public.family_sign_in_active(public.students) from public, anon;
grant execute on function public.family_sign_in_active(public.students) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Platform overview: family accounts that are switched on
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a super administrator can view the platform overview.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'schools', (select count(*) from public.schools where is_active),
    'clusters', (select count(*) from public.clusters),
    'blocks', (select count(*) from public.blocks),
    'districts', (select count(*) from public.districts),
    'staff', (
      select coalesce(jsonb_object_agg(role, total), '{}'::jsonb)
      from (
        select a.role, count(distinct a.user_id) as total
        from public.staff_assignments as a
        join public.profiles as p on p.id = a.user_id
        where p.is_active
          and a.starts_on <= private.today()
          and (a.ends_on is null or a.ends_on >= private.today())
        group by a.role
      ) as by_role
    ),
    'students', (
      select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
      from (select status, count(*) as total from public.students group by status) as by_status
    ),
    'family_accounts', (
      select count(*)
      from public.students as st
      join public.profiles as p on p.id = st.auth_user_id
      where st.status = 'active' and p.is_active
    ),
    'current_academic_year', (
      select jsonb_build_object('id', id, 'label', label, 'starts_on', starts_on, 'ends_on', ends_on)
      from public.academic_years
      where private.today() between starts_on and ends_on
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Schools overview for CRPs and teachers: only teachers whose accounts are switched on
-- ---------------------------------------------------------------------------------------------

create or replace function public.my_schools_overview()
returns table (
  school_id uuid,
  udise_code text,
  name_en text,
  name_hi text,
  cluster_id uuid,
  active_students bigint,
  pending_students bigint,
  teachers bigint,
  current_classes bigint
)
language sql
stable
set search_path = ''
as $$
  select
    s.id,
    s.udise_code,
    s.name_en,
    s.name_hi,
    s.cluster_id,
    (select count(*) from public.students as st where st.school_id = s.id and st.status = 'active'),
    (select count(*) from public.students as st where st.school_id = s.id and st.status = 'pending'),
    (select count(distinct a.user_id)
     from public.staff_assignments as a
     join public.profiles as p on p.id = a.user_id
     where a.school_id = s.id
       and a.role = 'teacher'
       and p.is_active
       and a.starts_on <= private.today()
       and (a.ends_on is null or a.ends_on >= private.today())),
    (select count(*)
     from public.class_sections as cs
     join public.academic_years as y on y.id = cs.academic_year_id
     where cs.school_id = s.id
       and cs.is_active
       and private.today() between y.starts_on and y.ends_on)
  from public.schools as s
  where s.id = any (private.staff_school_ids())
  order by s.name_en
$$;
