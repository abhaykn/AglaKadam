-- Audit trail of administrative changes: who changed which record, when, and what changed.
-- Events are written by triggers and readable only by super administrators. High-volume classroom
-- records such as attendance are not audited; they carry their own `marked_by` and timestamps.

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text not null,
  table_name text not null,
  operation text not null,
  record_id text,
  changes jsonb not null,
  constraint audit_events_operation_valid check (operation in ('INSERT', 'UPDATE', 'DELETE'))
);

comment on table public.audit_events is
  'Administrative change history. For updates, `changes` holds only the fields that changed.';
comment on column public.audit_events.actor_id is
  'Account that made the change; empty for system jobs. Not a foreign key, so history survives '
  'account removal.';

create index audit_events_occurred_at_idx on public.audit_events (occurred_at desc);
create index audit_events_table_record_idx on public.audit_events (table_name, record_id);
create index audit_events_actor_id_idx on public.audit_events (actor_id);

create function private.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  changed jsonb;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
    into changed
    from jsonb_each(new_row) as n
    join jsonb_each(old_row) as o on o.key = n.key
    where n.value is distinct from o.value
      and n.key <> 'updated_at';

    if changed is null then
      return null;
    end if;
  else
    changed := coalesce(new_row, old_row);
  end if;

  insert into public.audit_events (actor_id, actor_role, table_name, operation, record_id, changes)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'role', 'system'),
    tg_table_name,
    tg_op,
    coalesce(new_row, old_row) ->> 'id',
    changed
  );

  return null;
end;
$$;

create trigger audit_states after insert or update or delete on public.states
  for each row execute function private.record_audit_event();
create trigger audit_districts after insert or update or delete on public.districts
  for each row execute function private.record_audit_event();
create trigger audit_blocks after insert or update or delete on public.blocks
  for each row execute function private.record_audit_event();
create trigger audit_clusters after insert or update or delete on public.clusters
  for each row execute function private.record_audit_event();
create trigger audit_schools after insert or update or delete on public.schools
  for each row execute function private.record_audit_event();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function private.record_audit_event();
create trigger audit_staff_assignments after insert or update or delete on public.staff_assignments
  for each row execute function private.record_audit_event();
create trigger audit_academic_years after insert or update or delete on public.academic_years
  for each row execute function private.record_audit_event();
create trigger audit_class_sections after insert or update or delete on public.class_sections
  for each row execute function private.record_audit_event();
create trigger audit_class_teachers after insert or update or delete on public.class_teachers
  for each row execute function private.record_audit_event();
create trigger audit_students after insert or update or delete on public.students
  for each row execute function private.record_audit_event();
create trigger audit_student_contacts after insert or update or delete on public.student_contacts
  for each row execute function private.record_audit_event();
create trigger audit_enrolments after insert or update or delete on public.enrolments
  for each row execute function private.record_audit_event();
create trigger audit_guardian_consents after insert or delete on public.guardian_consents
  for each row execute function private.record_audit_event();

-- Audit events are kept for two years.
create function private.purge_expired_audit_events()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed bigint;
begin
  delete from public.audit_events where occurred_at < now() - interval '2 years';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function private.record_audit_event() from public;
revoke all on function private.purge_expired_audit_events() from public;
revoke all on function private.purge_expired_audit_events() from anon, authenticated, service_role;

alter table public.audit_events enable row level security;

revoke all on table public.audit_events from anon, authenticated, service_role;
revoke all on sequence public.audit_events_id_seq from anon, authenticated, service_role;
grant select on table public.audit_events to authenticated, service_role;

create policy "Super administrators can read the audit trail" on public.audit_events
  for select to authenticated using ((select private.is_super_admin()));
