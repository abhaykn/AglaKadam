-- Notifications on the phone (Web Push), free of any paid messaging service.
--
-- A person who allows notifications on a phone leaves its push subscription here. Three kinds are
-- sent, each of which the person can switch off:
--   * plan_ready  CRPs, on Sunday evening: the coming week can be planned, with the check-backs due
--                 and the teachers' requests waiting.
--   * check_back  The morning an agreed step is due for its check-back: the CRPs of the school's
--                 cluster, and the teacher who was observed while they still teach at the school.
--   * pulse_week  Teachers, the morning a Pulse week opens: how many children of their classes are
--                 due (the classes they teach, and those of their school without a teacher).
-- Subscriptions are kept only for the browsers' own push services, so that the sending function
-- never calls any other address.
-- The `notify` Edge Function sends them, called by the database's schedule with a token kept in
-- Vault, like the retention job. A message says what is due; it never names a child.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_format check (
    endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
    and char_length(endpoint) <= 1000
  ),
  constraint push_subscriptions_p256dh_format check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  constraint push_subscriptions_auth_format check (auth_secret ~ '^[A-Za-z0-9_-]{16,32}$')
);

comment on table public.push_subscriptions is
  'Phones that receive notifications: the browser''s push subscription, one per phone and account.';

create index push_subscriptions_profile_id_idx on public.push_subscriptions (profile_id);

create table public.notification_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  plan_ready boolean not null default true,
  check_back boolean not null default true,
  pulse_week boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.notification_settings is
  'The kinds of notification a person wants; everything is on until they switch it off.';

create trigger notification_settings_touch_updated_at before update on public.notification_settings
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Keeping a subscription
-- ---------------------------------------------------------------------------------------------

-- A phone that changes hands (another account signs in on it) must stop receiving the previous
-- account's notifications, whose rows that account cannot see.
create function private.release_push_endpoint(target_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions
  where endpoint = target_endpoint and profile_id is distinct from auth.uid()
$$;

-- Keeps this phone's push subscription for the signed-in person.
create function public.keep_push_subscription(endpoint text, p256dh text, auth_secret text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_staff() then
    raise exception 'Notifications are for staff accounts.' using errcode = '42501';
  end if;
  perform private.release_push_endpoint(keep_push_subscription.endpoint);
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_secret)
  values (auth.uid(), keep_push_subscription.endpoint, keep_push_subscription.p256dh,
    keep_push_subscription.auth_secret)
  on conflict on constraint push_subscriptions_endpoint_key do update
  set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret;
end;
$$;

comment on function public.keep_push_subscription(text, text, text) is
  'Keeps this phone''s push subscription for the signed-in staff member.';

revoke all on function private.release_push_endpoint(text) from public;
grant execute on function private.release_push_endpoint(text) to authenticated;
revoke all on function public.keep_push_subscription(text, text, text) from public, anon;
grant execute on function public.keep_push_subscription(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

alter table public.push_subscriptions enable row level security;
alter table public.notification_settings enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated, service_role;
revoke all on table public.notification_settings from anon, authenticated, service_role;

grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select, insert, update on table public.notification_settings to authenticated;

create policy "People keep their own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy "People choose their own notifications" on public.notification_settings
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Who receives what
-- ---------------------------------------------------------------------------------------------

-- The subscriptions to notify of one kind on a day, with the counts the message reports. Reads
-- past the access policies; only the secret key's role reaches it, through the service function.
create function private.push_recipients(kind text, on_date date)
returns table (
  endpoint text,
  p256dh text,
  auth_secret text,
  language text,
  message text,
  first_count integer,
  second_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select p.id, p.preferred_language
    from public.profiles as p
    where p.is_active and not p.password_change_required
  ),
  active as (
    select a.user_id, a.role, a.school_id, a.cluster_id
    from public.staff_assignments as a
    where a.starts_on <= on_date and (a.ends_on is null or a.ends_on >= on_date)
  ),
  wanted as (
    select s.endpoint, s.p256dh, s.auth_secret, s.profile_id, people.preferred_language,
      coalesce(n.plan_ready, true) as plan_ready,
      coalesce(n.check_back, true) as check_back,
      coalesce(n.pulse_week, true) as pulse_week
    from public.push_subscriptions as s
    join people on people.id = s.profile_id
    left join public.notification_settings as n on n.profile_id = s.profile_id
  ),
  -- Agreed steps whose check-back no later visit has done.
  open_steps as (
    select v.id, v.crp_id, v.teacher_id, v.school_id, f.check_back_on
    from public.visits as v
    join public.visit_feedback as f on f.visit_id = v.id
    where v.status = 'done'
      and f.agreed_at is not null
      and not exists (
        select 1 from public.visits as later
        where later.follows_visit_id = v.id and later.status = 'done'
      )
  ),
  crp_plans as (
    select a.user_id,
      (select count(*)::integer
       from open_steps as o
       join public.schools as sc on sc.id = o.school_id
       where sc.cluster_id = a.cluster_id
         and o.check_back_on between on_date + 1 and on_date + 7) as check_backs,
      (select count(*)::integer
       from public.visit_requests as r
       join public.schools as sc on sc.id = r.school_id
       where sc.cluster_id = a.cluster_id
         and r.withdrawn_at is null
         and r.answered_by_visit_id is null) as requests
    from active as a
    where a.role = 'crp'
  ),
  crp_plan_totals as (
    select user_id, sum(check_backs)::integer as check_backs, sum(requests)::integer as requests
    from crp_plans
    group by user_id
  ),
  -- Any CRP of the cluster may make the check-back, so all of them hear of it.
  crp_due as (
    select distinct a.user_id, o.id
    from open_steps as o
    join public.schools as sc on sc.id = o.school_id
    join active as a on a.role = 'crp' and a.cluster_id = sc.cluster_id
    where o.check_back_on = on_date
  ),
  due_steps as (
    select d.user_id, 'check_back_crp' as message, count(*)::integer as steps
    from crp_due as d
    group by d.user_id
    union all
    select o.teacher_id, 'check_back_teacher', count(*)::integer
    from open_steps as o
    where o.check_back_on = on_date
      and o.teacher_id is not null
      and exists (
        select 1 from active as a
        where a.user_id = o.teacher_id and a.role = 'teacher' and a.school_id = o.school_id
      )
    group by o.teacher_id
  ),
  -- Children due in the classes a teacher teaches, or in classes of their school without a teacher;
  -- children who take the adapted check are due like the others.
  pulse_due as (
    select a.user_id, count(distinct s.id)::integer as children
    from active as a
    join public.class_sections as c on c.school_id = a.school_id and c.is_active
    join public.pulse_samples as s on s.class_section_id = c.id
    where a.role = 'teacher'
      and s.week is not null
      and s.replaced_at is null
      and s.opens_on = on_date
      and (
        exists (
          select 1 from public.class_teachers as t
          where t.class_section_id = c.id and t.teacher_id = a.user_id
        )
        or not exists (
          select 1 from public.class_teachers as t where t.class_section_id = c.id
        )
      )
    group by a.user_id
  )
  select w.endpoint, w.p256dh, w.auth_secret, w.preferred_language, 'plan_ready',
    t.check_backs, t.requests
  from wanted as w
  join crp_plan_totals as t on t.user_id = w.profile_id
  where kind = 'plan_ready' and w.plan_ready
  union all
  select w.endpoint, w.p256dh, w.auth_secret, w.preferred_language, d.message, d.steps, 0
  from wanted as w
  join due_steps as d on d.user_id = w.profile_id
  where kind = 'daily' and w.check_back
  union all
  select w.endpoint, w.p256dh, w.auth_secret, w.preferred_language, 'pulse_week', p.children, 0
  from wanted as w
  join pulse_due as p on p.user_id = w.profile_id
  where kind = 'daily' and w.pulse_week
$$;

revoke all on function private.push_recipients(text, date) from public;
grant execute on function private.push_recipients(text, date) to service_role;

-- Like the other service functions, these run with the caller's rights: only the secret key's
-- role may call them.
create function public.service_push_recipients(kind text, on_date date)
returns table (
  endpoint text,
  p256dh text,
  auth_secret text,
  language text,
  message text,
  first_count integer,
  second_count integer
)
language sql
stable
set search_path = ''
as $$
  select * from private.push_recipients(kind, on_date)
$$;

-- Notes which subscriptions received a message, and forgets those the push service has dropped.
create function public.service_push_outcome(sent text[], gone text[])
returns void
language sql
set search_path = ''
as $$
  update public.push_subscriptions set last_sent_at = now() where endpoint = any (sent);
  delete from public.push_subscriptions where endpoint = any (gone);
$$;

grant select, update, delete on table public.push_subscriptions to service_role;

revoke all on function public.service_push_recipients(text, date) from public, anon, authenticated;
revoke all on function public.service_push_outcome(text[], text[]) from public, anon, authenticated;
grant execute on function
  public.service_push_recipients(text, date),
  public.service_push_outcome(text[], text[])
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'Vault is not available; the notification job token was not created.';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'notify_job_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notify_job_token',
      'Sent by the notification jobs to the notify Edge Function.'
    );
  end if;
end;
$$;

-- Asks the Edge Function to send one kind of notification. Does nothing (with a notice) until the
-- project URL is in Vault and the network extension is installed.
create function private.request_notifications(kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  token text := private.job_token('notify');
begin
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
  then
    raise notice 'Vault or pg_net is not available; no notifications were sent.';
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into project_url
    using 'project_url';
  if project_url is null or token is null then
    raise notice 'The project URL is not in Vault yet; no notifications were sent.';
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using
      rtrim(project_url, '/') || '/functions/v1/notify',
      jsonb_build_object('Content-Type', 'application/json', 'x-job-token', token),
      jsonb_build_object('kind', kind);
end;
$$;

revoke all on function private.request_notifications(text) from public;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; the notification schedule was not created.';
    return;
  end if;
  -- 13:30 UTC on Sunday is 19:00 IST, when a CRP prepares the week.
  perform cron.schedule(
    'notify-plan-ready',
    '30 13 * * 0',
    $job$select private.request_notifications('plan_ready')$job$
  );
  -- 01:30 UTC is 07:00 IST, before school starts; it follows the night's Pulse draw.
  perform cron.schedule(
    'notify-daily',
    '30 1 * * *',
    $job$select private.request_notifications('daily')$job$
  );
end;
$$;
