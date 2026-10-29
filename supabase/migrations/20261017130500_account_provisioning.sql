-- Account provisioning.
--
-- Accounts are created by the provisioning service with the secret key. It passes the details below
-- in `app_metadata`, which only the secret key can write, so a user can never grant themselves a
-- role. The Auth service inserts the identity first and applies `app_metadata` in a later update of
-- the same transaction, so the trigger reacts to both events and provisions each account once. The
-- profile and first assignment therefore commit or fail together with the sign-in identity.
--
--   Staff:   { "provisioning": { "account_kind": "staff", "full_name": "...",
--                                "preferred_language": "hi", "phone": "9876543210",
--                                "provisioned_by": "<administrator uuid>",
--                                "assignment": { "role": "crp", "scope_id": "<cluster uuid>",
--                                                "starts_on": "2025-06-01" } } }
--   Family:  { "provisioning": { "account_kind": "student", "student_id": "<student uuid>",
--                                "preferred_language": "hi" } }
--
-- `scope_id` is the district, block, cluster or school matching the role; super administrators
-- have no scope. `starts_on` is optional and records an existing posting; it defaults to today. An identity created any other way (for example from the dashboard) gets no profile
-- and therefore no access.

create function private.provision_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisioning constant jsonb := new.raw_app_meta_data -> 'provisioning';
  account_kind text;
  preferred_language text;
  assignment jsonb;
  assignment_role public.staff_role;
  scope_id uuid;
  student_name text;
begin
  if provisioning is null or jsonb_typeof(provisioning) <> 'object' then
    return new;
  end if;

  -- Later metadata updates (for example by the Auth service at sign-in) must not provision again.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  account_kind := provisioning ->> 'account_kind';
  preferred_language := coalesce(provisioning ->> 'preferred_language', 'hi');

  if account_kind = 'staff' then
    assignment := provisioning -> 'assignment';
    if assignment is null or jsonb_typeof(assignment) <> 'object' then
      raise exception 'Staff provisioning requires an assignment.' using errcode = '22023';
    end if;

    assignment_role := (assignment ->> 'role')::public.staff_role;
    scope_id := (assignment ->> 'scope_id')::uuid;

    if assignment_role <> 'super_admin' and scope_id is null then
      raise exception 'The % role requires a scope.', assignment_role using errcode = '22023';
    end if;

    insert into public.profiles (id, account_kind, full_name, preferred_language, phone)
    values (
      new.id,
      'staff',
      btrim(provisioning ->> 'full_name'),
      preferred_language,
      nullif(btrim(provisioning ->> 'phone'), '')
    );

    insert into public.staff_assignments (
      user_id, role, district_id, block_id, cluster_id, school_id, starts_on, created_by
    )
    values (
      new.id,
      assignment_role,
      case when assignment_role = 'district_officer' then scope_id end,
      case when assignment_role = 'block_officer' then scope_id end,
      case when assignment_role = 'crp' then scope_id end,
      case when assignment_role = 'teacher' then scope_id end,
      coalesce((assignment ->> 'starts_on')::date, private.today()),
      (provisioning ->> 'provisioned_by')::uuid
    );

  elsif account_kind = 'student' then
    update public.students
    set auth_user_id = new.id
    where id = (provisioning ->> 'student_id')::uuid
      and auth_user_id is null
      and status = 'active'
    returning full_name into student_name;

    if not found then
      raise exception 'The student record does not exist, is not verified or already has an account.'
        using errcode = '22023';
    end if;

    insert into public.profiles (id, account_kind, full_name, preferred_language)
    values (new.id, 'student', student_name, preferred_language);

  else
    raise exception 'Unknown account kind "%".', account_kind using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger on_auth_user_provisioning
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function private.provision_account();

-- The Auth service inserts identities as `supabase_auth_admin`; schema access keeps the trigger
-- working regardless of how the platform resolves trigger functions.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
  end if;
end;
$$;

-- One-time set-up of the first super administrator, run from the SQL editor after creating the
-- account under Authentication > Users. It refuses to run once a super administrator exists.
create function private.bootstrap_super_admin(account_email text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if exists (
    select 1 from public.staff_assignments where role = 'super_admin' and ends_on is null
  ) then
    raise exception 'A super administrator already exists. Add further administrators from the administration console.'
      using errcode = '42501';
  end if;

  select id into target_id from auth.users where lower(email) = lower(btrim(account_email));
  if target_id is null then
    raise exception 'No account uses the email address %. Create it under Authentication > Users first.',
      account_email
      using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles where id = target_id) then
    raise exception 'This account is already linked to a profile.' using errcode = '22023';
  end if;

  insert into public.profiles (id, account_kind, full_name, preferred_language)
  values (target_id, 'staff', btrim(display_name), 'en');

  insert into public.staff_assignments (user_id, role) values (target_id, 'super_admin');

  return target_id;
end;
$$;

revoke all on function private.provision_account() from public;
revoke all on function private.bootstrap_super_admin(text, text) from public;
revoke all on function private.bootstrap_super_admin(text, text) from anon, authenticated, service_role;
