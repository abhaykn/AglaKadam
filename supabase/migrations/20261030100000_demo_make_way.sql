-- A visitor who opens the demonstration is never turned away because the places are taken.
--
-- Until now, when all twenty-five places were taken, only a district opened more than a day ago made
-- way, so a crowd (judges opening the demonstration on one day) could see "busy" while districts
-- that nobody was using still stood. Now the oldest district that has been open for at least ten
-- minutes makes way, so a district someone has just opened is never taken from them. The visitor
-- is told `busy` only when every district is that young, that is, when the demonstration really is
-- crowded. A district that makes way expires at once and is removed, with its accounts, by the
-- sweep, as one that expired by itself.
--
-- Districts opened in a day are limited to three hundred (it was a hundred): a district that makes
-- way takes its data with it, so the limit only bounds the work of building them.

create or replace function private.demo_open(client_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key constant text := left(coalesce(nullif(btrim(client_key), ''), 'unknown'), 128);
  today_date constant date := (now() at time zone 'Asia/Kolkata')::date;
  sandbox private.demo_sandboxes;
  opened integer;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('agla.demo_open'));

  -- A district lives in the current academic session; one is never made up for it.
  if not exists (
    select 1 from public.academic_years where today_date between starts_on and ends_on
  ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- A district whose building stopped half-way is removed with the expired ones.
  update private.demo_sandboxes
  set expires_at = now()
  where status = 'building' and created_at < now() - interval '15 minutes' and expires_at > now();

  -- When all places are taken, the oldest district that has been open for ten minutes makes way.
  if (select count(*) from private.demo_sandboxes where expires_at > now()) >= 25 then
    update private.demo_sandboxes
    set expires_at = now()
    where id = (
      select id from private.demo_sandboxes
      where expires_at > now() and created_at < now() - interval '10 minutes'
      order by created_at
      limit 1
    );
  end if;
  if (select count(*) from private.demo_sandboxes where expires_at > now()) >= 25
     or (select count(*) from private.demo_sandboxes where created_at > now() - interval '1 day') >= 300
  then
    return jsonb_build_object('status', 'busy');
  end if;
  -- Judges or a class of trainees may share one network: twenty an hour from one network.
  select count(*), min(s.created_at) into opened, oldest
  from private.demo_sandboxes as s
  where s.client_key = key and s.created_at > now() - interval '1 hour';
  if opened >= 20 then
    return jsonb_build_object(
      'status', 'throttled',
      'retry_after_seconds', greatest(60, ceil(extract(epoch from oldest + interval '1 hour' - now())))::integer
    );
  end if;

  insert into private.demo_sandboxes (client_key) values (key) returning * into sandbox;
  return jsonb_build_object('status', 'ok', 'sandbox', sandbox.id);
end;
$$;
