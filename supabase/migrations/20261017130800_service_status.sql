-- Lightweight endpoint for uptime checks and the scheduled keep-alive request. It reads no data and
-- is the only function callable without signing in.

create function public.service_status()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('status', 'ok', 'checked_at', now())
$$;

comment on function public.service_status() is 'Reports that the database is reachable.';

revoke all on function public.service_status() from public;
grant execute on function public.service_status() to anon, authenticated, service_role;
