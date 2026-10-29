-- Scheduled maintenance with pg_cron. Schedules are in UTC.
--
-- The block is skipped where pg_cron is unavailable (for example in the automated test database);
-- on the hosted platform the extension is installed into pg_catalog as the platform documents.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; scheduled jobs were not created.';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  grant usage on schema cron to postgres;
  grant all privileges on all tables in schema cron to postgres;

  -- 20:30 UTC on the first day of every month, which is 02:00 IST on the second day.
  perform cron.schedule(
    'purge-expired-audit-events',
    '30 20 1 * *',
    'select private.purge_expired_audit_events()'
  );
end;
$$;
