-- Administrative hierarchy of school education: state, district, block, cluster and school.
-- Codes follow the identifiers used by the education department (UDISE+ for schools). Records are
-- created by administrators through provisioning; the platform ships no geography of its own.
--
-- Access policies are defined in the access control migration, once the helpers they rely on exist.
-- Until then, row level security without policies denies every API request.

create table public.states (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_en text not null,
  name_hi text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint states_code_key unique (code),
  constraint states_code_format check (code ~ '^[0-9A-Z]{1,12}$'),
  constraint states_name_en_length check (char_length(btrim(name_en)) between 1 and 120),
  constraint states_name_hi_length check (
    name_hi is null or char_length(btrim(name_hi)) between 1 and 120
  )
);

create table public.districts (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references public.states (id) on delete restrict,
  code text not null,
  name_en text not null,
  name_hi text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint districts_state_code_key unique (state_id, code),
  constraint districts_code_format check (code ~ '^[0-9A-Z]{1,12}$'),
  constraint districts_name_en_length check (char_length(btrim(name_en)) between 1 and 120),
  constraint districts_name_hi_length check (
    name_hi is null or char_length(btrim(name_hi)) between 1 and 120
  )
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id) on delete restrict,
  code text not null,
  name_en text not null,
  name_hi text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blocks_district_code_key unique (district_id, code),
  constraint blocks_code_format check (code ~ '^[0-9A-Z]{1,12}$'),
  constraint blocks_name_en_length check (char_length(btrim(name_en)) between 1 and 120),
  constraint blocks_name_hi_length check (
    name_hi is null or char_length(btrim(name_hi)) between 1 and 120
  )
);

create table public.clusters (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.blocks (id) on delete restrict,
  code text not null,
  name_en text not null,
  name_hi text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clusters_block_code_key unique (block_id, code),
  constraint clusters_code_format check (code ~ '^[0-9A-Z]{1,12}$'),
  constraint clusters_name_en_length check (char_length(btrim(name_en)) between 1 and 120),
  constraint clusters_name_hi_length check (
    name_hi is null or char_length(btrim(name_hi)) between 1 and 120
  )
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id) on delete restrict,
  udise_code text not null,
  name_en text not null,
  name_hi text,
  village text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schools_udise_code_key unique (udise_code),
  constraint schools_udise_code_format check (udise_code ~ '^[0-9]{11}$'),
  constraint schools_name_en_length check (char_length(btrim(name_en)) between 1 and 160),
  constraint schools_name_hi_length check (
    name_hi is null or char_length(btrim(name_hi)) between 1 and 160
  ),
  constraint schools_village_length check (
    village is null or char_length(btrim(village)) between 1 and 120
  )
);

create index schools_cluster_id_idx on public.schools (cluster_id);

comment on table public.states is 'States and union territories covered by this deployment.';
comment on table public.districts is 'Districts within a state.';
comment on table public.blocks is 'Blocks (development blocks) within a district.';
comment on table public.clusters is 'Clusters (cluster resource centres) within a block.';
comment on table public.schools is 'Schools, identified by their 11-digit UDISE+ code.';

create trigger states_touch_updated_at before update on public.states
  for each row execute function private.touch_updated_at();
create trigger districts_touch_updated_at before update on public.districts
  for each row execute function private.touch_updated_at();
create trigger blocks_touch_updated_at before update on public.blocks
  for each row execute function private.touch_updated_at();
create trigger clusters_touch_updated_at before update on public.clusters
  for each row execute function private.touch_updated_at();
create trigger schools_touch_updated_at before update on public.schools
  for each row execute function private.touch_updated_at();

create trigger states_keep_identifier before update on public.states
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger districts_keep_identifier before update on public.districts
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger blocks_keep_identifier before update on public.blocks
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger clusters_keep_identifier before update on public.clusters
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();
create trigger schools_keep_identifier before update on public.schools
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

alter table public.states enable row level security;
alter table public.districts enable row level security;
alter table public.blocks enable row level security;
alter table public.clusters enable row level security;
alter table public.schools enable row level security;

revoke all on table public.states, public.districts, public.blocks, public.clusters, public.schools
  from anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.states, public.districts, public.blocks, public.clusters, public.schools
  to authenticated, service_role;
