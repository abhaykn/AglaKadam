-- Removing Pulse recordings after the 30-day listening window.
--
-- A check's audio is kept for 30 days after the server received it, so that the CRP can listen to
-- it; then the file is deleted and only the check's form, item and (later) scores remain. Uploads
-- that no check claims within two days are deleted too.
--
-- Files can only be deleted through the Storage API (removing their rows here would leave the
-- stored files behind), so a daily job asks the `pulse-retention` Edge Function to do it. The
-- request carries a random token that this migration creates in Vault; no person ever needs to
-- see or copy it. The job also needs the project's URL in Vault under the name `project_url` (see
-- the setup guide); without it the job does nothing.

-- ---------------------------------------------------------------------------------------------
-- What to remove
-- ---------------------------------------------------------------------------------------------

-- Like the other service functions, these run with the caller's rights: only the secret key's
-- role may call them, and it reads and updates these tables itself.

-- Recordings due for removal: those older than the listening window, then uploads no check refers
-- to. At most `batch_size` of each.
create function public.service_pulse_audio_to_remove(batch_size integer default 200)
returns table (path text, reason text)
language sql
stable
set search_path = ''
as $$
  (
    select k.audio_path, 'expired'
    from public.pulse_checks as k
    where k.audio_deleted_at is null
      and k.audio_path is not null
      and k.received_at < now() - interval '30 days'
    order by k.received_at
    limit greatest(batch_size, 0)
  )
  union all
  (
    select o.name, 'unclaimed'
    from storage.objects as o
    where o.bucket_id = 'pulse-audio'
      and o.created_at < now() - interval '2 days'
      -- A file uploaded again to the path of a check whose audio was already removed is not kept.
      and not exists (
        select 1 from public.pulse_checks as k
        where k.audio_path = o.name and k.audio_deleted_at is null
      )
    order by o.created_at
    limit greatest(batch_size, 0)
  )
$$;

comment on function public.service_pulse_audio_to_remove(integer) is
  'Pulse recordings to delete through the Storage API: past the 30-day window, or never claimed.';

-- Notes that the audio of these checks has been deleted. Returns how many checks were updated.
create function public.service_mark_pulse_audio_removed(paths text[])
returns integer
language sql
set search_path = ''
as $$
  with removed as (
    update public.pulse_checks
    set audio_deleted_at = now()
    where audio_path = any (paths) and audio_deleted_at is null
    returning 1
  )
  select count(*)::integer from removed
$$;

-- ---------------------------------------------------------------------------------------------
-- Job token
-- ---------------------------------------------------------------------------------------------

-- The secret a scheduled job sends to its Edge Function, read from Vault; null without Vault.
create function private.job_token(job text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  token text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into token
    using job || '_job_token';
  return token;
end;
$$;

-- Whether `token` is the job's current token. Called by the Edge Function with the secret key.
create function public.service_job_token_valid(job text, token text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    private.job_token(job) is not null
      and length(token) = 64
      and token = private.job_token(job),
    false
  )
$$;

do $$
begin
  -- The function's signature differs between Vault versions; its first three arguments do not.
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'Vault is not available; the Pulse retention job token was not created.';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'pulse_retention_job_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'pulse_retention_job_token',
      'Sent by the daily Pulse retention job to the pulse-retention Edge Function.'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------------------------

-- Asks the Edge Function to remove what is due. Does nothing (with a notice) until the project URL
-- is in Vault and the network extension is installed.
create function private.request_pulse_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  token text := private.job_token('pulse_retention');
begin
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
  then
    raise notice 'Vault or pg_net is not available; Pulse recordings were not tidied.';
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into project_url
    using 'project_url';
  if project_url is null or token is null then
    raise notice 'The project URL is not in Vault yet; Pulse recordings were not tidied.';
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using
      rtrim(project_url, '/') || '/functions/v1/pulse-retention',
      jsonb_build_object('Content-Type', 'application/json', 'x-job-token', token),
      '{}'::jsonb;
end;
$$;

revoke all on function public.service_pulse_audio_to_remove(integer) from public, anon, authenticated;
revoke all on function public.service_mark_pulse_audio_removed(text[]) from public, anon, authenticated;
revoke all on function public.service_job_token_valid(text, text) from public, anon, authenticated;
revoke all on function private.job_token(text) from public;
revoke all on function private.request_pulse_retention() from public;

grant execute on function
  public.service_pulse_audio_to_remove(integer),
  public.service_mark_pulse_audio_removed(text[]),
  public.service_job_token_valid(text, text),
  private.job_token(text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (select 1 from pg_extension where extname = 'pg_net')
  then
    create extension pg_net;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the Pulse retention schedule was not created.';
    return;
  end if;

  -- 21:15 UTC is 02:45 IST, when nobody is recording.
  perform cron.schedule(
    'pulse-audio-retention',
    '15 21 * * *',
    'select private.request_pulse_retention()'
  );
end;
$$;
