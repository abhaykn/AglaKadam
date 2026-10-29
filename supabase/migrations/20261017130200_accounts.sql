-- Accounts and staff roles.
--
-- Every sign-in identity lives in `auth.users`. A matching profile is created only through
-- administrator provisioning (see the account provisioning migration); an identity without a
-- profile has no access to any data.
--
-- Staff responsibilities are modelled as dated assignments rather than a single role column, so a
-- transfer ends one assignment and starts another while the history is preserved.

create type public.staff_role as enum (
  'super_admin',
  'district_officer',
  'block_officer',
  'crp',
  'teacher'
);

comment on type public.staff_role is
  'super_admin: platform administrator. district_officer and block_officer: DIET and block '
  'education office staff, limited to aggregate reports. crp: cluster resource person. '
  'teacher: classroom teacher.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  account_kind text not null,
  full_name text not null,
  preferred_language text not null default 'hi',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_account_kind_valid check (account_kind in ('staff', 'student')),
  constraint profiles_full_name_length check (char_length(btrim(full_name)) between 1 and 120),
  constraint profiles_preferred_language_valid check (preferred_language in ('en', 'hi')),
  constraint profiles_phone_format check (phone is null or phone ~ '^[6-9][0-9]{9}$')
);

comment on table public.profiles is
  'One row per provisioned account. Staff and student accounts share this table.';
comment on column public.profiles.phone is 'Indian mobile number without country code.';

create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.staff_role not null,
  district_id uuid references public.districts (id) on delete restrict,
  block_id uuid references public.blocks (id) on delete restrict,
  cluster_id uuid references public.clusters (id) on delete restrict,
  school_id uuid references public.schools (id) on delete restrict,
  starts_on date not null default private.today(),
  ends_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An end date one day before the start date cancels an assignment that should never have applied.
  constraint staff_assignments_period_valid check (ends_on is null or ends_on >= starts_on - 1),
  -- Each role is scoped to exactly one level of the hierarchy.
  constraint staff_assignments_scope_matches_role check (
    (role = 'super_admin'
      and num_nonnulls(district_id, block_id, cluster_id, school_id) = 0)
    or (role = 'district_officer'
      and district_id is not null and num_nonnulls(block_id, cluster_id, school_id) = 0)
    or (role = 'block_officer'
      and block_id is not null and num_nonnulls(district_id, cluster_id, school_id) = 0)
    or (role = 'crp'
      and cluster_id is not null and num_nonnulls(district_id, block_id, school_id) = 0)
    or (role = 'teacher'
      and school_id is not null and num_nonnulls(district_id, block_id, cluster_id) = 0)
  )
);

comment on table public.staff_assignments is
  'Dated role assignments. An assignment is active from starts_on to ends_on inclusive (IST).';

-- A person holds at most one open assignment per role and scope.
create unique index staff_assignments_one_open_per_scope
  on public.staff_assignments (user_id, role, coalesce(school_id, cluster_id, block_id, district_id))
  nulls not distinct
  where ends_on is null;

create index staff_assignments_user_id_idx on public.staff_assignments (user_id);
create index staff_assignments_district_id_idx on public.staff_assignments (district_id);
create index staff_assignments_block_id_idx on public.staff_assignments (block_id);
create index staff_assignments_cluster_id_idx on public.staff_assignments (cluster_id);
create index staff_assignments_school_id_idx on public.staff_assignments (school_id);
create index staff_assignments_created_by_idx on public.staff_assignments (created_by);

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger staff_assignments_touch_updated_at before update on public.staff_assignments
  for each row execute function private.touch_updated_at();

create trigger profiles_keep_identifier before update on public.profiles
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger staff_assignments_keep_identifier before update on public.staff_assignments
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

alter table public.profiles enable row level security;
alter table public.staff_assignments enable row level security;

revoke all on table public.profiles, public.staff_assignments from anon, authenticated, service_role;

-- Profiles are created by provisioning and removed together with the sign-in identity, so signed-in
-- users can only read and update them.
grant select, update on table public.profiles to authenticated;
-- Assignments are never deleted through the API; ending one keeps the history.
grant select, insert, update on table public.staff_assignments to authenticated;
grant select, insert, update, delete on table public.profiles, public.staff_assignments
  to service_role;
