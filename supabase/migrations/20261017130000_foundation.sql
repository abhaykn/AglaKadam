-- Foundation shared by every later migration: the private schema, required extensions and small
-- helpers.
--
-- Conventions used throughout the schema:
--   * Every table in `public` has row level security enabled and receives explicit grants. Nothing
--     relies on default privileges, so behaviour is identical whether or not the project exposes new
--     tables to the Data API automatically.
--   * Helper functions live in `private`, which is not exposed through the Data API. Functions that
--     read data on behalf of a policy are SECURITY DEFINER with an empty search_path and fully
--     qualified object names.
--   * Trigger functions that need to know who is calling are SECURITY INVOKER, so that
--     `current_user` reflects the caller rather than the function owner.

create schema if not exists private;

revoke all on schema private from public;

-- Signed-in users and the service role need USAGE so that policies and triggers can call the
-- helpers defined here. The schema is not exposed through the Data API, so clients cannot call these
-- functions directly.
grant usage on schema private to authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- Calendar date in India. The database clock runs in UTC, so `current_date` would still report the
-- previous day between midnight and 05:30 IST.
create function private.today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- True while a statement runs with the privileges of an anonymous or signed-in API user. Requests
-- made with the secret key, migrations and SECURITY DEFINER functions run as other roles; those are
-- trusted callers that are responsible for their own validation.
create function private.is_api_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('anon', 'authenticated')
$$;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Primary keys never change. Offline devices and stored arrays (such as attendance absences)
-- refer to records by id, so an id change would silently break those references.
create function private.keep_identifier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The identifier of a % record cannot be changed.', tg_table_name
    using errcode = '42501';
end;
$$;

revoke all on function private.today() from public;
revoke all on function private.is_api_user() from public;
revoke all on function private.touch_updated_at() from public;
revoke all on function private.keep_identifier() from public;

grant execute on function private.today() to authenticated, service_role;
grant execute on function private.is_api_user() to authenticated, service_role;
