-- Demonstration districts for visitors who share a network.
--
-- Judges at one venue, or a group of trainees, may all open the demo from the same network: it
-- now allows twenty districts an hour from one network instead of six (the limits on districts in
-- use and opened in a day still apply), and a refusal says when the next one can be opened.

-- Starts a district for a visitor, unless too many are in use (`busy`) or the visitor's network
-- started many in the last hour (`throttled`).
create or replace function private.demo_open(client_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key constant text := left(coalesce(nullif(btrim(client_key), ''), 'unknown'), 128);
  sandbox private.demo_sandboxes;
  opened integer;
  oldest timestamptz;
begin
  -- A district whose building stopped half-way is removed with the expired ones.
  update private.demo_sandboxes
  set expires_at = now()
  where status = 'building' and created_at < now() - interval '15 minutes' and expires_at > now();

  -- When all places are taken, the oldest district opened more than a day ago makes way.
  if (select count(*) from private.demo_sandboxes where expires_at > now()) >= 25 then
    update private.demo_sandboxes
    set expires_at = now()
    where id = (
      select id from private.demo_sandboxes
      where expires_at > now() and created_at < now() - interval '1 day'
      order by created_at
      limit 1
    );
  end if;
  if (select count(*) from private.demo_sandboxes where expires_at > now()) >= 25
     or (select count(*) from private.demo_sandboxes where created_at > now() - interval '1 day') >= 100
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
