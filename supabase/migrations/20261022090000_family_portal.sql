-- The family's view of their own child: results the school has shared, the child's attendance, and
-- notes and homework the teachers send to the class.
--
--   * Results reach a family only once a teacher (or the cluster's CRP) shares an exam's result for
--     a class, so that marks still being entered or checked are never shown. Sharing can be taken
--     back; marks corrected after sharing are shown as corrected.
--   * A family reads its own child's marks and the papers and exams they belong to, never another
--     child's. The history of changes to marks stays with the staff.
--   * Attendance is read through `my_attendance`, which returns only the child's own days: a class's
--     attendance record lists every absent child and is not shown to families.
--   * Class notes are short messages or homework a teacher of the school sends to a class, with at
--     most one picture or PDF. Families of the children enrolled in the class read them. A note can
--     be removed by the school's teachers but not changed, so a family never reads two versions;
--     a removed note does not come back when a phone sends it again.

-- ---------------------------------------------------------------------------------------------
-- Shared results
-- ---------------------------------------------------------------------------------------------

create table public.exam_result_shares (
  exam_id uuid not null references public.exams (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  shared_by uuid references public.profiles (id) on delete set null,
  shared_at timestamptz not null default now(),
  primary key (exam_id, class_section_id)
);

comment on table public.exam_result_shares is
  'An exam''s result shared with the families of one class. Families see marks only once shared.';

create index exam_result_shares_class_section_id_idx
  on public.exam_result_shares (class_section_id);
create index exam_result_shares_school_id_idx on public.exam_result_shares (school_id);
create index exam_result_shares_shared_by_idx on public.exam_result_shares (shared_by);

-- A result is shared for a class that has a paper in the exam. Who shared it, when, and the school
-- are recorded by the database.
create function private.guard_exam_result_share()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_user() then
    return new;
  end if;
  new.shared_by := auth.uid();
  new.shared_at := now();
  new.school_id := private.class_section_school_id(new.class_section_id);
  if new.school_id is null then
    raise exception 'There is no such class.' using errcode = '23503';
  end if;
  if not private.reads_school_marks(new.school_id) then
    raise exception 'Results are shared by the staff of the school.' using errcode = '42501';
  end if;
  if not private.exam_has_paper_in(new.exam_id, new.class_section_id) then
    raise exception 'The exam has no paper in this class.' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- Whether an exam has a paper in a class, also where the caller cannot see the paper.
create function private.exam_has_paper_in(target_exam_id uuid, target_class_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exam_papers as p
    where p.exam_id = target_exam_id and p.class_section_id = target_class_section_id
  )
$$;

create trigger exam_result_shares_guard_write before insert on public.exam_result_shares
  for each row execute function private.guard_exam_result_share();

-- The papers whose marks the signed-in family may read: those of their child in a shared result.
create function private.family_paper_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.paper_id), '{}')
  from public.exam_marks as m
  join public.exam_papers as p on p.id = m.paper_id
  join public.exam_result_shares as r
    on r.exam_id = p.exam_id and r.class_section_id = p.class_section_id
  where m.student_id = private.current_student_id()
$$;

create function private.family_exam_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.exam_id), '{}')
  from public.exam_papers as p
  where p.id = any (private.family_paper_ids())
$$;

-- ---------------------------------------------------------------------------------------------
-- Attendance of the family's child
-- ---------------------------------------------------------------------------------------------

-- The days the signed-in family's child was on a class's roll and attendance was taken, and whether
-- the child was present. A child moving class on a day is on both rolls; present in either counts.
create function private.own_attendance(since date)
returns table (attendance_date date, present boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.attendance_date, bool_or(not (e.student_id = any (a.absent_student_ids)))
  from public.enrolments as e
  join public.attendance_sessions as a
    on a.class_section_id = e.class_section_id
    and a.attendance_date >= e.enrolled_on
    and (e.ended_on is null or a.attendance_date <= e.ended_on)
  where e.student_id = private.current_student_id()
    and a.attendance_date between coalesce(since, private.today() - 400) and private.today()
  group by a.attendance_date
  order by a.attendance_date
$$;

-- ---------------------------------------------------------------------------------------------
-- Class notes
-- ---------------------------------------------------------------------------------------------

create table public.class_notes (
  id uuid primary key,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  kind text not null default 'message',
  body text not null,
  due_on date,
  attachment_path text,
  attachment_type text,
  attachment_bytes integer,
  attachment_name text,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  constraint class_notes_kind_valid check (kind in ('message', 'homework')),
  constraint class_notes_body_length check (char_length(btrim(body)) between 1 and 1000),
  constraint class_notes_due_on_valid check (due_on is null or kind = 'homework'),
  constraint class_notes_attachment_complete check (
    num_nonnulls(attachment_path, attachment_type, attachment_bytes) in (0, 3)
    and (attachment_name is null or attachment_path is not null)
  ),
  constraint class_notes_attachment_type_valid check (
    attachment_type is null
    or attachment_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  constraint class_notes_attachment_size check (
    attachment_bytes is null or attachment_bytes between 1 and 1048576
  ),
  constraint class_notes_attachment_name_length check (
    attachment_name is null or char_length(attachment_name) between 1 and 120
  ),
  constraint class_notes_attachment_path_key unique (attachment_path)
);

comment on table public.class_notes is
  'A message or homework a teacher sends to the families of a class, with at most one picture or '
  'PDF.';
comment on column public.class_notes.id is
  'Chosen by the device, so that a note written without a network can be sent later.';
comment on column public.class_notes.author_name is
  'The teacher''s name as it was when the note was sent, shown to families.';

create index class_notes_class_section_id_idx
  on public.class_notes (class_section_id, created_at desc);
create index class_notes_school_id_idx on public.class_notes (school_id);
create index class_notes_author_id_idx on public.class_notes (author_id);

-- The class a note's file is stored under: `<class>/<note>.<extension>`.
create function private.class_note_class(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
    then split_part(object_name, '/', 1)::uuid
  end
$$;

-- Whether the signed-in person may send notes to a class: a teacher of the school of an active class.
create function private.may_send_class_note(target_class_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_sections as c
    where c.id = target_class_section_id
      and c.is_active
      and (c.school_id = any (private.teacher_school_ids()) or private.is_super_admin())
  )
$$;

-- Who stored a note's file, and its storage details, read past the storage policies.
create function private.class_note_object(object_name text)
returns table (owner_id text, metadata jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.owner_id, o.metadata
  from storage.objects as o
  where o.bucket_id = 'class-notes' and o.name = object_name
$$;

-- Notes removed by the school's teachers. A phone that sends one again (its first answer lost)
-- must not bring it back.
create table private.class_note_removals (
  note_id uuid primary key,
  class_section_id uuid not null,
  removed_at timestamptz not null default now()
);

revoke all on table private.class_note_removals from public, anon, authenticated, service_role;

create function private.record_class_note_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.class_note_removals (note_id, class_section_id)
  values (old.id, old.class_section_id)
  on conflict do nothing;
  return old;
end;
$$;

-- Whether a note was already sent, also where the caller cannot see it.
create function private.class_note_exists(target_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.class_notes where id = target_note_id)
$$;

create function private.class_note_removed(target_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.class_note_removals where note_id = target_note_id)
$$;

-- Notes a class received today, counted past the access policies.
create function private.class_notes_today(target_class_section_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.class_notes as n
  where n.class_section_id = target_class_section_id
    and (n.created_at at time zone 'Asia/Kolkata')::date = private.today()
$$;

-- A note is written once by a teacher of the class's school. The school, the author and the time
-- are recorded by the database, and a file's type and size are taken from storage. A class gets at
-- most 30 notes a day. Homework is due within 60 days; a note written without a network may arrive
-- after its day, so a due date up to 14 days past is kept as written.
create function private.guard_class_note_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stored record;
  extension text;
begin
  if not private.is_api_user() then
    return new;
  end if;
  new.school_id := private.class_section_school_id(new.class_section_id);
  if new.school_id is null then
    raise exception 'There is no such class.' using errcode = '23503';
  end if;
  new.author_id := auth.uid();
  new.created_at := now();
  new.body := btrim(new.body);
  new.author_name := (select p.full_name from public.profiles as p where p.id = auth.uid());
  if not private.may_send_class_note(new.class_section_id) then
    raise exception 'Notes are sent by the teachers of the class''s school.' using errcode = '42501';
  end if;
  -- A note sent again from the phone's queue is left as the server holds it, and a removed one
  -- stays removed.
  if private.class_note_exists(new.id) then
    return new;
  end if;
  if private.class_note_removed(new.id) then
    return null;
  end if;
  if new.due_on is not null
     and new.due_on not between private.today() - 14 and private.today() + 60
  then
    raise exception 'Homework is due within the next 60 days.' using errcode = '23514';
  end if;
  if private.class_notes_today(new.class_section_id) >= 30 then
    raise exception 'A class receives at most 30 notes a day.' using errcode = '23514';
  end if;

  if new.attachment_path is not null then
    select o.owner_id, o.metadata into stored from private.class_note_object(new.attachment_path) as o;
    if not found then
      raise exception 'The note''s file is not in storage.' using errcode = '23514';
    end if;
    if stored.owner_id is distinct from auth.uid()::text then
      raise exception 'The note''s file was stored by someone else.' using errcode = '42501';
    end if;
    new.attachment_type := coalesce(
      nullif(btrim(split_part(stored.metadata ->> 'mimetype', ';', 1)), ''),
      new.attachment_type
    );
    new.attachment_bytes := coalesce((stored.metadata ->> 'size')::integer, new.attachment_bytes);
    new.attachment_name := nullif(btrim(new.attachment_name), '');
    extension := case new.attachment_type
      when 'image/jpeg' then 'jpg'
      when 'image/png' then 'png'
      when 'image/webp' then 'webp'
      when 'application/pdf' then 'pdf'
    end;
    if extension is null
       or new.attachment_path <> new.class_section_id || '/' || new.id || '.' || extension
    then
      raise exception 'A note''s file is stored under its class and its own identifier.'
        using errcode = '23514';
    end if;
  else
    new.attachment_type := null;
    new.attachment_bytes := null;
    new.attachment_name := null;
  end if;
  return new;
end;
$$;

create trigger class_notes_guard_write before insert on public.class_notes
  for each row execute function private.guard_class_note_write();
create trigger class_notes_record_removal after delete on public.class_notes
  for each row execute function private.record_class_note_removal();

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on function private.guard_exam_result_share() from public;
revoke all on function private.exam_has_paper_in(uuid, uuid) from public;
revoke all on function private.family_paper_ids() from public;
revoke all on function private.family_exam_ids() from public;
revoke all on function private.own_attendance(date) from public;
revoke all on function private.class_note_class(text) from public;
revoke all on function private.may_send_class_note(uuid) from public;
revoke all on function private.class_note_object(text) from public;
revoke all on function private.class_note_exists(uuid) from public;
revoke all on function private.class_note_removed(uuid) from public;
revoke all on function private.record_class_note_removal() from public;
revoke all on function private.class_notes_today(uuid) from public;
revoke all on function private.guard_class_note_write() from public;

grant execute on function
  private.exam_has_paper_in(uuid, uuid),
  private.family_paper_ids(),
  private.family_exam_ids(),
  private.own_attendance(date),
  private.class_note_class(text),
  private.may_send_class_note(uuid),
  private.class_note_object(text),
  private.class_note_exists(uuid),
  private.class_note_removed(uuid),
  private.class_notes_today(uuid)
  to authenticated, service_role;

alter table public.exam_result_shares enable row level security;
alter table public.class_notes enable row level security;

revoke all on table public.exam_result_shares from anon, authenticated, service_role;
revoke all on table public.class_notes from anon, authenticated, service_role;
grant select, insert, delete on table public.exam_result_shares to authenticated;
grant select, insert, delete on table public.class_notes to authenticated;
grant select on table public.exam_result_shares, public.class_notes to service_role;

-- ---------------------------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------------------------

create policy "Staff of the school can read shared results" on public.exam_result_shares
  for select to authenticated
  using (private.reads_school_marks(school_id));
create policy "Staff of the school can share a result" on public.exam_result_shares
  for insert to authenticated
  with check (private.reads_school_marks(school_id));
create policy "Staff of the school can take back a shared result" on public.exam_result_shares
  for delete to authenticated
  using (private.reads_school_marks(school_id));

create policy "Families can read their child's shared marks" on public.exam_marks
  for select to authenticated
  using (
    student_id = (select private.current_student_id())
    and paper_id = any ((select private.family_paper_ids())::uuid[])
  );
create policy "Families can read the papers of their child's shared marks" on public.exam_papers
  for select to authenticated
  using (id = any ((select private.family_paper_ids())::uuid[]));
create policy "Families can read the exams of their child's shared marks" on public.exams
  for select to authenticated
  using (id = any ((select private.family_exam_ids())::uuid[]));

create policy "Staff of the school can read class notes" on public.class_notes
  for select to authenticated
  using (
    (select private.is_super_admin())
    or school_id = any ((select private.staff_school_ids())::uuid[])
  );
create policy "Families can read the notes of their child's class" on public.class_notes
  for select to authenticated
  using (class_section_id = any ((select private.student_class_section_ids())::uuid[]));
create policy "Teachers can send notes to classes of their school" on public.class_notes
  for insert to authenticated
  with check (private.may_send_class_note(class_section_id));
create policy "Teachers of the school can remove class notes" on public.class_notes
  for delete to authenticated
  using (
    (select private.is_super_admin())
    or school_id = any ((select private.teacher_school_ids())::uuid[])
  );

-- ---------------------------------------------------------------------------------------------
-- The family's attendance
-- ---------------------------------------------------------------------------------------------

-- The signed-in family's child's attendance since a day (by default the last 400 days). Returns
-- nothing for staff accounts.
create function public.my_attendance(since date default null)
returns table (attendance_date date, present boolean)
language sql
stable
set search_path = ''
as $$
  select o.attendance_date, o.present from private.own_attendance(since) as o
$$;

revoke all on function public.my_attendance(date) from public, anon;
grant execute on function public.my_attendance(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Storage for the files of class notes
-- ---------------------------------------------------------------------------------------------

-- Pictures are made smaller on the phone before upload; a PDF of homework fits in a megabyte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'class-notes',
  'class-notes',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Teachers can upload the files of class notes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'class-notes'
    and private.class_note_class(name) is not null
    and private.may_send_class_note(private.class_note_class(name))
  );
-- The school's staff read a class's files; a family reads those of its child's class once a note
-- carries them.
create policy "Staff and families can read the files of class notes" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'class-notes'
    and (
      (select private.is_super_admin())
      or private.class_section_school_id(private.class_note_class(name))
        = any ((select private.staff_school_ids())::uuid[])
      or (
        private.class_note_class(name) = any ((select private.student_class_section_ids())::uuid[])
        and exists (select 1 from public.class_notes as n where n.attachment_path = name)
      )
    )
  );
-- A file is removed after its note, by a teacher of the school.
create policy "Teachers can remove the files of removed notes" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'class-notes'
    and private.class_section_school_id(private.class_note_class(name))
      = any ((select private.teacher_school_ids())::uuid[])
    and not exists (select 1 from public.class_notes as n where n.attachment_path = name)
  );
