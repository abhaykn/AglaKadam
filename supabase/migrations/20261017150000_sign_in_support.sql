-- Sign-in support: forced password change for staff, mobile numbers as staff sign-in identifiers,
-- and learner code + PIN credentials for family accounts.
--
-- Staff sign in with their 10-digit mobile number and a password. The first password is issued by an
-- administrator and must be changed at the first sign-in. Families sign in with the child's learner
-- code and a 6-digit PIN; PINs are stored as bcrypt hashes and repeated failures lock the account
-- for a growing period.

alter table public.profiles
  add column password_change_required boolean not null default false;

comment on column public.profiles.password_change_required is
  'Set when an administrator issues or resets a password; cleared once the user chooses their own.';

-- A mobile number identifies exactly one staff account.
create unique index profiles_staff_phone_key
  on public.profiles (phone)
  where account_kind = 'staff' and phone is not null;

-- An account signed in with an administrator-issued password gets no access to any records until
-- its owner chooses a password. The rule is enforced here rather than only in the application, so
-- a temporary password handed over on paper cannot be used to read data through the API.
create or replace function private.active_assignments()
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
    and not p.password_change_required
    and a.starts_on <= private.today()
    and (a.ends_on is null or a.ends_on >= private.today())
$$;

-- ---------------------------------------------------------------------------------------------
-- Provisioning: staff accounts start with an administrator-issued password.
-- ---------------------------------------------------------------------------------------------

create or replace function private.provision_account()
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

    insert into public.profiles (
      id, account_kind, full_name, preferred_language, phone, password_change_required
    )
    values (
      new.id,
      'staff',
      btrim(provisioning ->> 'full_name'),
      preferred_language,
      nullif(btrim(provisioning ->> 'phone'), ''),
      coalesce((provisioning ->> 'password_change_required')::boolean, true)
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

-- Users cannot clear their own password-change requirement; only the password service can, after
-- the password has actually been changed.
create or replace function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.account_kind is distinct from old.account_kind then
    raise exception 'The identity of an account cannot be changed.'
      using errcode = '42501';
  end if;

  if private.is_api_user() then
    if new.password_change_required is distinct from old.password_change_required then
      raise exception 'The password requirement is managed by the password service.'
        using errcode = '42501';
    end if;

    if not private.is_super_admin()
       and (new.full_name is distinct from old.full_name
            or new.is_active is distinct from old.is_active
            or new.phone is distinct from old.phone)
    then
      raise exception 'Only an administrator can change the name, mobile number or status of an account.'
        using errcode = '42501';
    end if;
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

-- ---------------------------------------------------------------------------------------------
-- Family credentials
-- ---------------------------------------------------------------------------------------------

create table private.family_credentials (
  student_id uuid primary key references public.students (id) on delete cascade,
  pin_hash text not null,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  issued_by uuid references public.profiles (id) on delete set null,
  issued_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  constraint family_credentials_failed_attempts_range check (failed_attempts between 0 and 1000)
);

comment on table private.family_credentials is
  'PIN hashes and lockout state for family sign-in. Reachable only by the sign-in service.';

create index family_credentials_issued_by_idx on private.family_credentials (issued_by);

revoke all on table private.family_credentials from public, anon, authenticated;
grant select, insert, update, delete on table private.family_credentials to service_role;

-- Stores a new PIN for a student's family account and clears any lockout. Called by the account
-- service after it has checked that the caller may issue family sign-ins for this student.
create function public.service_set_family_pin(target_student_id uuid, pin text, issued_by uuid)
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
      issued_by = excluded.issued_by,
      issued_at = now();
end;
$$;

-- Failed family sign-ins per client network (a hash of the address, never the address itself), so
-- that many learner codes cannot be tried from one place. Thirty failures within an hour pause
-- sign-in from that network until the hour has passed.
create table private.family_sign_in_throttle (
  client_key text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null default now(),
  constraint family_sign_in_throttle_client_key_length check (char_length(client_key) between 1 and 128),
  constraint family_sign_in_throttle_failures_range check (failures >= 0)
);

comment on table private.family_sign_in_throttle is
  'Failed family sign-ins per hashed client address within the current hour.';

revoke all on table private.family_sign_in_throttle from public, anon, authenticated;
grant select, insert, update, delete on table private.family_sign_in_throttle to service_role;

create function private.record_family_sign_in_failure(client text)
returns void
language sql
set search_path = ''
as $$
  insert into private.family_sign_in_throttle as t (client_key, failures, window_started_at)
  values (client, 1, now())
  on conflict (client_key) do update
  set failures = case
        when t.window_started_at > now() - interval '1 hour' then t.failures + 1
        else 1
      end,
      window_started_at = case
        when t.window_started_at > now() - interval '1 hour' then t.window_started_at
        else now()
      end
$$;

create function private.purge_family_sign_in_throttle()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from private.family_sign_in_throttle where window_started_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function private.record_family_sign_in_failure(text) from public, anon, authenticated;
revoke all on function private.purge_family_sign_in_throttle() from public, anon, authenticated, service_role;
grant execute on function private.record_family_sign_in_failure(text) to service_role;

-- Checks a learner code and PIN on behalf of a client network. Returns
-- `{"status": "ok", "user_id": ...}`, `{"status": "invalid"}`,
-- `{"status": "locked", "retry_after_seconds": n}` or `{"status": "throttled", "retry_after_seconds": n}`.
--
-- An unknown code and a wrong PIN give the same answer and take the same time (a PIN hash is
-- computed either way). After five consecutive failures the account locks for 15 minutes, doubling
-- with each further failure up to 24 hours. Every failure also counts against the client network.
create function public.service_verify_family_pin(learner_code text, pin text, client_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  credential record;
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

  select c.student_id, c.pin_hash, c.failed_attempts, c.locked_until, s.auth_user_id
  into credential
  from public.students as s
  join private.family_credentials as c on c.student_id = s.id
  join public.profiles as p on p.id = s.auth_user_id
  where s.student_code = learner_code
    and s.status = 'active'
    and p.is_active
  for update of c;

  if not found then
    -- Same work as a real check, so response times do not reveal which codes exist.
    perform extensions.crypt(pin, extensions.gen_salt('bf', 10));
    perform private.record_family_sign_in_failure(client);
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
    set failed_attempts = 0, locked_until = null, last_sign_in_at = now()
    where student_id = credential.student_id;
    return jsonb_build_object('status', 'ok', 'user_id', credential.auth_user_id);
  end if;

  attempts := credential.failed_attempts + 1;
  if attempts >= 5 then
    lock_until := now() + least(interval '15 minutes' * power(2, least(attempts - 5, 10)), interval '24 hours');
  end if;

  update private.family_credentials
  set failed_attempts = least(attempts, 1000), locked_until = lock_until
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

-- Removes a family sign-in, for example when the PIN slip is lost and the family should be locked out
-- until a new one is issued.
create function public.service_revoke_family_pin(target_student_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from private.family_credentials where student_id = target_student_id
$$;

revoke all on function public.service_set_family_pin(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.service_verify_family_pin(text, text, text) from public, anon, authenticated;
revoke all on function public.service_revoke_family_pin(uuid) from public, anon, authenticated;
grant execute on function public.service_set_family_pin(uuid, text, uuid) to service_role;
grant execute on function public.service_verify_family_pin(text, text, text) to service_role;

grant execute on function public.service_revoke_family_pin(uuid) to service_role;

-- Old throttle entries are removed daily (04:00 IST) where scheduled jobs are available. pg_cron is
-- installed by the scheduled-jobs migration; repeating CREATE EXTENSION here would re-run the
-- platform's privilege hooks for the extension, so this block only uses it when it is present.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the throttle clean-up job was not created.';
    return;
  end if;

  perform cron.schedule(
    'purge-family-sign-in-throttle',
    '30 22 * * *',
    'select private.purge_family_sign_in_throttle()'
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- What the signed-in user may do, in one round trip
-- ---------------------------------------------------------------------------------------------

-- Profile, active assignments with the names of their scopes, and for family accounts the child's
-- school and class. Runs with the caller's privileges, so it can only ever describe the caller.
-- Returns null for an identity that has no profile.
create function public.my_access()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'account_kind', p.account_kind,
    'full_name', p.full_name,
    'preferred_language', p.preferred_language,
    'phone', p.phone,
    'is_active', p.is_active,
    'password_change_required', p.password_change_required,
    'assignments', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'id', a.id,
           'role', a.role,
           'starts_on', a.starts_on,
           'ends_on', a.ends_on,
           'scope', case
             when a.district_id is not null then (
               select jsonb_build_object('type', 'district', 'id', d.id, 'code', d.code,
                                         'name_en', d.name_en, 'name_hi', d.name_hi)
               from public.districts as d where d.id = a.district_id)
             when a.block_id is not null then (
               select jsonb_build_object('type', 'block', 'id', b.id, 'code', b.code,
                                         'name_en', b.name_en, 'name_hi', b.name_hi)
               from public.blocks as b where b.id = a.block_id)
             when a.cluster_id is not null then (
               select jsonb_build_object('type', 'cluster', 'id', c.id, 'code', c.code,
                                         'name_en', c.name_en, 'name_hi', c.name_hi)
               from public.clusters as c where c.id = a.cluster_id)
             when a.school_id is not null then (
               select jsonb_build_object('type', 'school', 'id', s.id, 'code', s.udise_code,
                                         'name_en', s.name_en, 'name_hi', s.name_hi)
               from public.schools as s where s.id = a.school_id)
           end
         )
         order by a.role, a.starts_on
       )
       from public.staff_assignments as a
       where a.user_id = p.id
         and p.is_active
         and a.starts_on <= private.today()
         and (a.ends_on is null or a.ends_on >= private.today())),
      '[]'::jsonb
    ),
    'student', (
      select jsonb_build_object(
        'id', st.id,
        'full_name', st.full_name,
        'student_code', st.student_code,
        'school', (
          select jsonb_build_object('id', s.id, 'name_en', s.name_en, 'name_hi', s.name_hi)
          from public.schools as s where s.id = st.school_id),
        'class', (
          select jsonb_build_object('id', cs.id, 'grade', cs.grade, 'section', cs.section)
          from public.enrolments as e
          join public.class_sections as cs on cs.id = e.class_section_id
          where e.student_id = st.id and e.ended_on is null)
      )
      from public.students as st
      where st.auth_user_id = p.id and st.status = 'active' and p.is_active
    )
  )
  from public.profiles as p
  where p.id = auth.uid()
$$;

revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated, service_role;
