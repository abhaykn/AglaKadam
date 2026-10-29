-- School exams and their marks.
--
-- Schools hold their own exams: class tests, unit tests, the half-yearly (mid-term) and the annual
-- exam. They are scheduled in the application as one exam with a paper for each class and
-- subject: by a teacher for classes of their school, or by a CRP for the schools of their cluster.
-- Teachers check the answer sheets as always and type each child's marks, or a grade, into the
-- application, also without a network.
--
-- Marks are the school's own judgement over a whole syllabus; Pulse is an independent, random
-- check of reading and spoken English. Where both exist for a class, the CRP sees whether children
-- with high marks also read well in Pulse. A pattern of high marks and weak reading is a reason for
-- a conversation with the teacher, never a verdict, and only the CRP sees it.
--
-- Who sees what:
--   * Exams, papers and marks are read by the teachers of the school and the CRPs of its cluster.
--     Block and district offices see no child's marks; they receive aggregates only.
--   * An exam is scheduled through `save_exam` and removed through `remove_exam` by those who may
--     schedule it: the CRPs of its cluster, or the teachers of its school (and the CRPs of that
--     school's cluster). The school's teachers move their own papers (`move_exam_paper`) within
--     the exam's dates. Nothing with marks, or with a history of marks, is ever removed, and a
--     paper with marks keeps its day.
--   * Marks are written by the school's teachers, a whole paper at a time, through
--     `save_exam_marks`, from the day of the paper until 60 days after it.
--   * A mark changed a day or more after it was first written, or by someone else, leaves a line
--     in the paper's history, which the same people can read.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.exams (
  id uuid primary key,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  kind text not null,
  title text,
  cluster_id uuid references public.clusters (id) on delete restrict,
  school_id uuid references public.schools (id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exams_kind_valid check (kind in ('class_test', 'unit_test', 'half_yearly', 'annual')),
  constraint exams_title_length check (title is null or char_length(title) between 1 and 80),
  constraint exams_scope_valid check (num_nonnulls(cluster_id, school_id) = 1),
  constraint exams_period_valid check (ends_on between starts_on and starts_on + 45)
);

comment on table public.exams is
  'An exam a school holds, scheduled for one school or for the schools of a cluster.';
comment on column public.exams.id is
  'Chosen by the device, so that an exam scheduled without a network can be sent later.';

create index exams_academic_year_id_idx on public.exams (academic_year_id);
create index exams_cluster_id_idx on public.exams (cluster_id);
create index exams_school_id_idx on public.exams (school_id);
create index exams_created_by_idx on public.exams (created_by);

create trigger exams_touch_updated_at before update on public.exams
  for each row execute function private.touch_updated_at();
create trigger exams_keep_identifier before update on public.exams
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

create table public.exam_papers (
  id uuid primary key,
  exam_id uuid not null references public.exams (id) on delete cascade,
  class_section_id uuid not null references public.class_sections (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  subject text not null,
  subject_name text,
  held_on date not null,
  scale text not null default 'marks',
  max_marks smallint,
  revision integer not null default 0,
  client_change_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_papers_subject_valid check (
    subject in ('hindi', 'english', 'maths', 'evs', 'urdu', 'sanskrit', 'other')
  ),
  constraint exam_papers_subject_name_valid check (
    (subject = 'other') = (subject_name is not null)
    and (subject_name is null or char_length(subject_name) between 1 and 40)
  ),
  constraint exam_papers_scale_valid check (scale in ('marks', 'grades')),
  constraint exam_papers_max_marks_valid check (
    (scale = 'marks') = (max_marks is not null)
    and (max_marks is null or max_marks between 1 and 500)
  )
);

comment on table public.exam_papers is
  'One subject of an exam in one class: its date and how it is marked (out of a maximum, or by '
  'grade A to E).';
comment on column public.exam_papers.revision is
  'Counts the saves of the paper''s marks, so that a device never overwrites marks saved since it '
  'last looked unnoticed.';

create unique index exam_papers_one_per_subject
  on public.exam_papers (exam_id, class_section_id, subject, coalesce(subject_name, ''));
create index exam_papers_class_section_id_idx on public.exam_papers (class_section_id);
create index exam_papers_school_id_idx on public.exam_papers (school_id);
create index exam_papers_held_on_idx on public.exam_papers (held_on);

create trigger exam_papers_touch_updated_at before update on public.exam_papers
  for each row execute function private.touch_updated_at();
create trigger exam_papers_keep_identifier before update on public.exam_papers
  for each row when (new.id is distinct from old.id) execute function private.keep_identifier();

create table public.exam_marks (
  paper_id uuid not null references public.exam_papers (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  marks numeric(5, 1),
  grade text,
  absent boolean not null default false,
  entered_by uuid references public.profiles (id) on delete set null,
  entered_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (paper_id, student_id),
  constraint exam_marks_grade_valid check (grade is null or grade in ('A', 'B', 'C', 'D', 'E')),
  constraint exam_marks_value_valid check (
    case when absent then marks is null and grade is null else num_nonnulls(marks, grade) = 1 end
  ),
  constraint exam_marks_marks_range check (
    marks is null or (marks >= 0 and marks * 2 = round(marks * 2))
  )
);

comment on table public.exam_marks is
  'A child''s result in a paper: marks (in steps of a half), a grade, or absent.';

create index exam_marks_student_id_idx on public.exam_marks (student_id);
create index exam_marks_entered_by_idx on public.exam_marks (entered_by);
create index exam_marks_updated_by_idx on public.exam_marks (updated_by);

create table public.exam_mark_changes (
  id bigint generated always as identity primary key,
  paper_id uuid not null references public.exam_papers (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  old_marks numeric(5, 1),
  old_grade text,
  old_absent boolean not null,
  new_marks numeric(5, 1),
  new_grade text,
  new_absent boolean,
  removed boolean not null default false,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);

comment on table public.exam_mark_changes is
  'Marks changed a day or more after they were written, or by someone else: who changed them, '
  'when, and from what to what.';

create index exam_mark_changes_paper_id_idx on public.exam_mark_changes (paper_id);
create index exam_mark_changes_student_id_idx on public.exam_mark_changes (student_id);
create index exam_mark_changes_changed_by_idx on public.exam_mark_changes (changed_by);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Whether the signed-in person reads the exams and marks of a school: its teachers and the CRPs
-- of its cluster.
create function private.reads_school_marks(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or target_school_id = any (private.teacher_school_ids())
    or target_school_id = any (private.crp_school_ids())
$$;

-- The schools an exam is held in: its school, or the schools of its cluster.
create function private.exam_school_ids(target_exam_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.school_id is not null then array[e.school_id]
    else coalesce(
      (select array_agg(s.id) from public.schools as s where s.cluster_id = e.cluster_id),
      '{}'
    )
  end
  from public.exams as e
  where e.id = target_exam_id
$$;

-- Whether the signed-in person may schedule an exam for this cluster or school: a CRP for their
-- cluster or one of its schools, a teacher for their school.
create function private.may_schedule_exam(target_cluster_id uuid, target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or case
      when target_cluster_id is not null then target_cluster_id = any (private.crp_cluster_ids())
      else target_school_id = any (private.teacher_school_ids())
        or target_school_id = any (private.crp_school_ids())
    end
$$;

-- Whether the signed-in person may change or remove an exam: anyone who may schedule an exam of
-- the same scope, so that an exam does not become unmanageable when its author moves on.
create function private.may_manage_exam(target_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.may_schedule_exam(e.cluster_id, e.school_id)
     from public.exams as e
     where e.id = target_exam_id),
    false
  )
$$;

-- Whether an exam or a paper exists at all, also where the caller cannot see it.
create function private.exam_exists(target_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.exams where id = target_exam_id)
$$;

create function private.exam_paper_exists(target_paper_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.exam_papers where id = target_paper_id)
$$;

-- A mark as a share of the paper's maximum, in percent. Grades count at the middle of their band:
-- A from 80 %, B from 60 %, C from 40 %, D from 20 %, E below.
create function private.mark_percent(
  mark_value numeric,
  grade_value text,
  paper_max_marks smallint
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when mark_value is not null and paper_max_marks is not null
      then round(mark_value * 100 / paper_max_marks, 1)
    when grade_value is not null
      then case grade_value when 'A' then 90 when 'B' then 70 when 'C' then 50 when 'D' then 30
        when 'E' then 10 end
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------

-- An exam is written only through `save_exam`, which checks it as a whole.
create function private.guard_exam_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  year record;
begin
  if not private.is_api_user() then
    return new;
  end if;
  if coalesce(current_setting('agla.exam_change', true), '') = '' then
    raise exception 'An exam is saved whole, through save_exam.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if not private.may_schedule_exam(new.cluster_id, new.school_id) then
      raise exception 'Exams are scheduled for your own school or cluster.' using errcode = '42501';
    end if;
  elsif (new.academic_year_id, new.cluster_id, new.school_id, new.created_by, new.created_at)
        is distinct from
        (old.academic_year_id, old.cluster_id, old.school_id, old.created_by, old.created_at)
  then
    raise exception 'The session, place and author of an exam cannot be changed.'
      using errcode = '42501';
  end if;

  select y.starts_on, y.ends_on into year
  from public.academic_years as y
  where y.id = new.academic_year_id;
  if not found or new.starts_on < year.starts_on or new.ends_on > year.ends_on then
    raise exception 'An exam falls within its academic session.' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.starts_on is distinct from old.starts_on)
     and new.starts_on < private.today() - 60
  then
    raise exception 'An exam is recorded at most 60 days after it began.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.exam_papers as p
    where p.exam_id = new.id and p.held_on not between new.starts_on and new.ends_on
  ) then
    raise exception 'A paper is held within the dates of its exam.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger exams_guard_write before insert or update on public.exams
  for each row execute function private.guard_exam_write();

-- Exams and papers are removed only through `remove_exam` and `save_exam`, which keep anything with
-- marks. Removals the database makes itself (an exam taking its papers with it) are not affected.
create function private.guard_exam_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_user() and coalesce(current_setting('agla.exam_change', true), '') = '' then
    raise exception 'Exams are removed through remove_exam.' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger exams_guard_delete before delete on public.exams
  for each row execute function private.guard_exam_delete();
create trigger exam_papers_guard_delete before delete on public.exam_papers
  for each row execute function private.guard_exam_delete();

-- A paper belongs to an active class of a school the exam is held in, in the exam's session and
-- within its dates. Its school is taken from the class. Once marks exist, it keeps its day (so
-- that its 60 days cannot start again) and its way of marking, and its maximum is never lower
-- than a mark; a new maximum changes what the marks mean, so it counts as a new revision.
create function private.guard_exam_paper_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  exam record;
  section record;
  highest numeric;
  marked boolean;
begin
  if tg_op = 'UPDATE'
     and (new.exam_id, new.class_section_id, new.created_at)
         is distinct from (old.exam_id, old.class_section_id, old.created_at)
  then
    raise exception 'A paper cannot move to another exam or class.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.held_on is distinct from old.held_on
     and exists (select 1 from public.exam_marks as m where m.paper_id = new.id)
  then
    raise exception 'A paper with marks keeps its day.' using errcode = '23514';
  end if;

  if private.is_api_user() then
    if coalesce(current_setting('agla.exam_change', true), '') = ''
       and coalesce(current_setting('agla.exam_marks', true), '') = ''
    then
      raise exception 'A paper is changed through save_exam or move_exam_paper.'
        using errcode = '42501';
    end if;
    -- The revision is counted only by saves of the marks.
    if tg_op = 'INSERT' then
      new.revision := 0;
      new.client_change_id := null;
      new.created_at := now();
    elsif coalesce(current_setting('agla.exam_marks', true), '') = '' then
      new.revision := old.revision;
      new.client_change_id := old.client_change_id;
    end if;
  end if;

  select e.academic_year_id, e.cluster_id, e.school_id, e.starts_on, e.ends_on into exam
  from public.exams as e
  where e.id = new.exam_id;
  select c.school_id, c.academic_year_id, c.is_active, s.cluster_id into section
  from public.class_sections as c
  join public.schools as s on s.id = c.school_id
  where c.id = new.class_section_id;
  if not found then
    raise exception 'There is no such class.' using errcode = '23503';
  end if;
  new.school_id := section.school_id;

  if tg_op = 'INSERT' then
    if not section.is_active then
      raise exception 'Exams are held in active classes.' using errcode = '23514';
    end if;
    if section.academic_year_id is distinct from exam.academic_year_id then
      raise exception 'A paper belongs to a class of the exam''s session.' using errcode = '23514';
    end if;
    if (exam.school_id is not null and section.school_id <> exam.school_id)
       or (exam.cluster_id is not null and section.cluster_id <> exam.cluster_id)
    then
      raise exception 'A paper belongs to a class of the exam''s school or cluster.'
        using errcode = '23514';
    end if;
  end if;
  if new.held_on not between exam.starts_on and exam.ends_on then
    raise exception 'A paper is held within the dates of its exam.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (new.scale, new.max_marks) is distinct from (old.scale, old.max_marks)
  then
    select max(m.marks), bool_or(not m.absent) into highest, marked
    from public.exam_marks as m
    where m.paper_id = new.id;
    if coalesce(marked, false) and new.scale <> old.scale then
      raise exception 'A paper with marks keeps its way of marking.' using errcode = '23514';
    end if;
    if highest is not null and new.max_marks < highest then
      raise exception 'The maximum cannot be lower than a mark already given.'
        using errcode = '23514';
    end if;
    if coalesce(marked, false) and coalesce(current_setting('agla.exam_marks', true), '') = '' then
      new.revision := old.revision + 1;
    end if;
  end if;
  return new;
end;
$$;

create trigger exam_papers_guard_write before insert or update on public.exam_papers
  for each row execute function private.guard_exam_paper_write();

-- A mark is written only through `save_exam_marks`, which checks the paper as a whole. The device
-- does not say who wrote it or when.
create function private.guard_exam_mark_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_user() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if coalesce(current_setting('agla.exam_marks', true), '') = '' then
    raise exception 'Marks are saved a paper at a time, through save_exam_marks.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    new.entered_at := now();
  else
    new.entered_by := old.entered_by;
    new.entered_at := old.entered_at;
  end if;
  return new;
end;
$$;

create trigger exam_marks_guard_write before insert or update or delete on public.exam_marks
  for each row execute function private.guard_exam_mark_write();

-- Corrections are kept: a mark changed or removed a day or more after it was first written, or by
-- someone else, leaves a line in the paper's history. Changes made while typing do not. A paper or
-- child being removed takes its marks with it; there is nothing left to keep a history of.
create function private.record_exam_mark_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.marks, new.grade, new.absent) is not distinct from (old.marks, old.grade, old.absent)
  then
    return null;
  end if;
  if tg_op = 'DELETE'
     and (
       not exists (select 1 from public.exam_papers where id = old.paper_id)
       or not exists (select 1 from public.students where id = old.student_id)
     )
  then
    return null;
  end if;
  if old.entered_at < now() - interval '1 day' or old.updated_by is distinct from auth.uid() then
    insert into public.exam_mark_changes (
      paper_id, student_id, old_marks, old_grade, old_absent, new_marks, new_grade, new_absent,
      removed, changed_by
    )
    values (
      old.paper_id, old.student_id, old.marks, old.grade, old.absent,
      case when tg_op = 'UPDATE' then new.marks end,
      case when tg_op = 'UPDATE' then new.grade end,
      case when tg_op = 'UPDATE' then new.absent end,
      tg_op = 'DELETE',
      auth.uid()
    );
  end if;
  return null;
end;
$$;

create trigger exam_marks_record_change after update or delete on public.exam_marks
  for each row execute function private.record_exam_mark_change();

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------

revoke all on function private.reads_school_marks(uuid) from public;
revoke all on function private.exam_school_ids(uuid) from public;
revoke all on function private.may_schedule_exam(uuid, uuid) from public;
revoke all on function private.may_manage_exam(uuid) from public;
revoke all on function private.exam_exists(uuid) from public;
revoke all on function private.exam_paper_exists(uuid) from public;
revoke all on function private.mark_percent(numeric, text, smallint) from public;
revoke all on function private.guard_exam_write() from public;
revoke all on function private.guard_exam_delete() from public;
revoke all on function private.guard_exam_paper_write() from public;
revoke all on function private.guard_exam_mark_write() from public;
revoke all on function private.record_exam_mark_change() from public;

grant execute on function
  private.reads_school_marks(uuid),
  private.exam_school_ids(uuid),
  private.may_schedule_exam(uuid, uuid),
  private.may_manage_exam(uuid),
  private.exam_exists(uuid),
  private.exam_paper_exists(uuid),
  private.mark_percent(numeric, text, smallint)
  to authenticated, service_role;

alter table public.exams enable row level security;
alter table public.exam_papers enable row level security;
alter table public.exam_marks enable row level security;
alter table public.exam_mark_changes enable row level security;

revoke all on table public.exams from anon, authenticated, service_role;
revoke all on table public.exam_papers from anon, authenticated, service_role;
revoke all on table public.exam_marks from anon, authenticated, service_role;
revoke all on table public.exam_mark_changes from anon, authenticated, service_role;
-- The history is written only by its trigger.
revoke all on sequence public.exam_mark_changes_id_seq from anon, authenticated, service_role;

-- Writes go through the functions below, which run with the caller's rights; the triggers above
-- refuse writes made around them.
grant select, insert, update, delete on table public.exams to authenticated;
grant select, insert, update, delete on table public.exam_papers to authenticated;
grant select, insert, update, delete on table public.exam_marks to authenticated;
grant select on table public.exam_mark_changes to authenticated;
grant select on table public.exams, public.exam_papers, public.exam_marks,
  public.exam_mark_changes to service_role;

create policy "Staff of the schools can read exams" on public.exams
  for select to authenticated
  using (
    exists (
      select 1 from unnest(private.exam_school_ids(id)) as school
      where private.reads_school_marks(school)
    )
  );
create policy "Staff can schedule exams for their school or cluster" on public.exams
  for insert to authenticated
  with check (private.may_schedule_exam(cluster_id, school_id));
create policy "Staff of the exam's school or cluster can change it" on public.exams
  for update to authenticated
  using (private.may_manage_exam(id))
  with check (private.may_schedule_exam(cluster_id, school_id));
create policy "Staff of the exam's school or cluster can remove it" on public.exams
  for delete to authenticated
  using (private.may_manage_exam(id));

-- The school lists are read once per statement rather than once per row.
create policy "Staff of the school can read its papers" on public.exam_papers
  for select to authenticated
  using (
    school_id = any (
      (select private.teacher_school_ids() || private.crp_school_ids())::uuid[]
    )
    or (select private.is_super_admin())
  );
create policy "Staff of the exam's school or cluster can add papers" on public.exam_papers
  for insert to authenticated
  with check (private.may_manage_exam(exam_id));
create policy "The school's teachers and the exam's managers can change papers" on public.exam_papers
  for update to authenticated
  using (
    school_id = any ((select private.teacher_school_ids())::uuid[])
    or private.may_manage_exam(exam_id)
  )
  with check (
    school_id = any ((select private.teacher_school_ids())::uuid[])
    or private.may_manage_exam(exam_id)
  );
create policy "Staff of the exam's school or cluster can remove papers" on public.exam_papers
  for delete to authenticated
  using (private.may_manage_exam(exam_id));

create policy "Staff of the school can read marks" on public.exam_marks
  for select to authenticated
  using (
    exists (
      select 1 from public.exam_papers as p
      where p.id = exam_marks.paper_id
        and (
          p.school_id = any (
            (select private.teacher_school_ids() || private.crp_school_ids())::uuid[]
          )
          or (select private.is_super_admin())
        )
    )
  );
create policy "Teachers of the school can enter marks" on public.exam_marks
  for insert to authenticated
  with check (
    exists (
      select 1 from public.exam_papers as p
      where p.id = exam_marks.paper_id
        and (
          p.school_id = any ((select private.teacher_school_ids())::uuid[])
          or (select private.is_super_admin())
        )
    )
  );
create policy "Teachers of the school can correct marks" on public.exam_marks
  for update to authenticated
  using (
    exists (
      select 1 from public.exam_papers as p
      where p.id = exam_marks.paper_id
        and (
          p.school_id = any ((select private.teacher_school_ids())::uuid[])
          or (select private.is_super_admin())
        )
    )
  )
  with check (
    exists (
      select 1 from public.exam_papers as p
      where p.id = exam_marks.paper_id
        and (
          p.school_id = any ((select private.teacher_school_ids())::uuid[])
          or (select private.is_super_admin())
        )
    )
  );
create policy "Teachers of the school can clear marks" on public.exam_marks
  for delete to authenticated
  using (
    exists (
      select 1 from public.exam_papers as p
      where p.id = exam_marks.paper_id
        and (
          p.school_id = any ((select private.teacher_school_ids())::uuid[])
          or (select private.is_super_admin())
        )
    )
  );

create policy "Staff of the school can read the history of marks" on public.exam_mark_changes
  for select to authenticated
  using (
    exists (
      select 1 from public.exam_papers as p
      where p.id = exam_mark_changes.paper_id
        and (
          p.school_id = any (
            (select private.teacher_school_ids() || private.crp_school_ids())::uuid[]
          )
          or (select private.is_super_admin())
        )
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------------------------

-- Saves an exam with its papers, as the device holds it: a new exam, or a change by those who may
-- manage it. A paper already saved keeps its day and marking, which its school may have changed
-- since; new papers are added, and papers left out are removed unless they have marks or a
-- history of marks. Sending the same exam again changes nothing.
create function public.save_exam(exam jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  kept uuid[];
  held record;
begin
  if jsonb_typeof(exam) is distinct from 'object' or jsonb_typeof(exam -> 'id') <> 'string'
     or jsonb_typeof(exam -> 'papers') <> 'array'
  then
    raise exception 'An exam is an object with an id and its papers.' using errcode = '22023';
  end if;
  if jsonb_array_length(exam -> 'papers') = 0 or jsonb_array_length(exam -> 'papers') > 600 then
    raise exception 'An exam has from 1 to 600 papers.' using errcode = '22023';
  end if;
  target_id := (exam ->> 'id')::uuid;
  perform set_config('agla.exam_change', 'on', true);

  if private.exam_exists(target_id) then
    if not private.may_manage_exam(target_id) then
      raise exception 'This exam is outside your school or cluster.' using errcode = '42501';
    end if;
    update public.exams
    set kind = exam ->> 'kind',
      title = nullif(btrim(exam ->> 'title'), ''),
      starts_on = (exam ->> 'starts_on')::date,
      ends_on = (exam ->> 'ends_on')::date
    where id = target_id
      and (kind, title, starts_on, ends_on) is distinct from (
        exam ->> 'kind',
        nullif(btrim(exam ->> 'title'), ''),
        (exam ->> 'starts_on')::date,
        (exam ->> 'ends_on')::date
      );
  else
    insert into public.exams (
      id, academic_year_id, kind, title, cluster_id, school_id, starts_on, ends_on
    )
    values (
      target_id,
      (exam ->> 'academic_year_id')::uuid,
      exam ->> 'kind',
      nullif(btrim(exam ->> 'title'), ''),
      nullif(exam ->> 'cluster_id', '')::uuid,
      nullif(exam ->> 'school_id', '')::uuid,
      (exam ->> 'starts_on')::date,
      (exam ->> 'ends_on')::date
    );
  end if;

  select coalesce(array_agg((value ->> 'id')::uuid), '{}') into kept
  from jsonb_array_elements(exam -> 'papers');
  if exists (
    select 1 from public.exam_papers as p
    where p.exam_id = target_id
      and not (p.id = any (kept))
      and (
        exists (select 1 from public.exam_marks as m where m.paper_id = p.id)
        or exists (select 1 from public.exam_mark_changes as h where h.paper_id = p.id)
      )
  ) then
    raise exception 'A paper with marks cannot be removed.' using errcode = '23514';
  end if;
  delete from public.exam_papers where exam_id = target_id and not (id = any (kept));

  for held in
    select p.id, p.class_section_id, p.subject, nullif(btrim(p.subject_name), '') as subject_name,
      p.held_on, coalesce(p.scale, 'marks') as scale, p.max_marks
    from jsonb_to_recordset(exam -> 'papers') as p (
      id uuid, class_section_id uuid, subject text, subject_name text, held_on date, scale text,
      max_marks smallint
    )
  loop
    if private.exam_paper_exists(held.id) then
      if not exists (
        select 1 from public.exam_papers as p
        where p.id = held.id
          and p.exam_id = target_id
          and p.class_section_id = held.class_section_id
          and p.subject = held.subject
          and p.subject_name is not distinct from held.subject_name
      ) then
        raise exception 'A paper keeps its exam, class and subject.' using errcode = '23514';
      end if;
      continue;
    end if;
    insert into public.exam_papers (
      id, exam_id, class_section_id, school_id, subject, subject_name, held_on, scale, max_marks
    )
    values (
      held.id, target_id, held.class_section_id,
      private.class_section_school_id(held.class_section_id), held.subject, held.subject_name,
      held.held_on, held.scale, case when held.scale = 'marks' then held.max_marks end
    );
  end loop;

  perform set_config('agla.exam_change', '', true);
end;
$$;

comment on function public.save_exam(jsonb) is
  'Saves an exam with its papers. Papers already saved keep their day and marking; papers with '
  'marks are never removed.';

-- Moves one paper to another day of its exam, or changes its maximum: for the school's teachers,
-- whose classes may sit a cluster's exam on different days, and for those who manage the exam.
create function public.move_exam_paper(
  target_paper_id uuid,
  new_held_on date,
  new_max_marks smallint default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('agla.exam_change', 'on', true);
  update public.exam_papers
  set held_on = new_held_on,
    max_marks = case when scale = 'marks' then coalesce(new_max_marks, max_marks) end
  where id = target_paper_id
    and (held_on, max_marks) is distinct from (
      new_held_on,
      case when scale = 'marks' then coalesce(new_max_marks, max_marks) end
    );
  if not found and not exists (
    select 1 from public.exam_papers as p
    where p.id = target_paper_id
      and (
        p.school_id = any (private.teacher_school_ids())
        or private.may_manage_exam(p.exam_id)
      )
  ) then
    raise exception 'This paper is not one you can change.' using errcode = '42501';
  end if;
  perform set_config('agla.exam_change', '', true);
end;
$$;

-- Removes an exam that has neither marks nor a history of marks.
create function public.remove_exam(target_exam_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.exam_exists(target_exam_id) then
    return;
  end if;
  if not private.may_manage_exam(target_exam_id) then
    raise exception 'This exam is outside your school or cluster.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.exam_papers as p
    where p.exam_id = target_exam_id
      and (
        exists (select 1 from public.exam_marks as m where m.paper_id = p.id)
        or exists (select 1 from public.exam_mark_changes as h where h.paper_id = p.id)
      )
  ) then
    raise exception 'An exam with marks cannot be removed.' using errcode = '23514';
  end if;
  perform set_config('agla.exam_change', 'on', true);
  delete from public.exams where id = target_exam_id;
  perform set_config('agla.exam_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Marks
-- ---------------------------------------------------------------------------------------------

-- Saves the marks of one paper as the device holds them, from the day of the paper until 60 days
-- after it. Like a visit, a save names the revision it started from; one that started from an
-- older revision than the server's is refused, unless the newer one is the device's own earlier
-- save. Children not on the class's roll on the paper's day are ignored, and children not listed
-- have no mark. Returns the new revision.
create function public.save_exam_marks(paper_marks jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  base integer;
  change_id uuid;
  supersedes uuid[];
  paper record;
  roll uuid[];
  saved integer;
begin
  if jsonb_typeof(paper_marks) is distinct from 'object'
     or jsonb_typeof(paper_marks -> 'paper_id') <> 'string'
     or jsonb_typeof(paper_marks -> 'change_id') <> 'string'
     or jsonb_typeof(paper_marks -> 'entries') <> 'array'
  then
    raise exception 'Marks are an object with the paper, a change identifier and the entries.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(paper_marks -> 'base_revision') not in ('number', 'null') then
    raise exception 'The base revision is a number.' using errcode = '22023';
  end if;
  target_id := (paper_marks ->> 'paper_id')::uuid;
  base := (paper_marks ->> 'base_revision')::integer;
  change_id := (paper_marks ->> 'change_id')::uuid;
  supersedes := coalesce(
    (
      select array_agg(value::uuid)
      from jsonb_array_elements_text(paper_marks -> 'supersedes') as value
    ),
    '{}'
  );
  if cardinality(supersedes) > 50 or jsonb_array_length(paper_marks -> 'entries') > 200 then
    raise exception 'A save holds at most 200 children and supersedes at most 50 saves.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(paper_marks -> 'entries') as e (student_id uuid)
    group by e.student_id
    having count(*) > 1
  ) then
    raise exception 'A child is listed once.' using errcode = '22023';
  end if;

  -- The paper is locked for the save, so that its maximum, way of marking and day cannot change
  -- while the marks are checked against them.
  select p.id, p.class_section_id, p.school_id, p.held_on, p.scale, p.max_marks, p.revision,
    p.client_change_id
  into paper
  from public.exam_papers as p
  where p.id = target_id
  for update;
  if not found then
    if private.exam_paper_exists(target_id) then
      raise exception 'Marks are entered by the school''s teachers.' using errcode = '42501';
    end if;
    -- The exam scheduled on the same device may still be on its way: worth sending again later.
    raise exception 'The paper is not on the server yet.' using errcode = '55000';
  end if;
  -- A save already applied (its answer was lost) is answered again.
  if paper.client_change_id = change_id then
    return paper.revision;
  end if;
  if not (paper.school_id = any (private.teacher_school_ids()) or private.is_super_admin()) then
    raise exception 'Marks are entered by the school''s teachers.' using errcode = '42501';
  end if;
  if paper.held_on > private.today() then
    raise exception 'Marks are entered from the day of the paper.' using errcode = '23514';
  end if;
  if paper.held_on < private.today() - 60 and not private.is_super_admin() then
    raise exception 'Marks can be changed for 60 days after the paper.' using errcode = '42501';
  end if;
  if base is distinct from paper.revision
     and not (paper.client_change_id is not null and paper.client_change_id = any (supersedes))
     and not (base is null and paper.revision = 0)
  then
    raise exception 'The marks were changed on another device.' using errcode = '40001';
  end if;

  -- Each entry is a number of marks (in steps of a half), a grade or absent, as the paper is
  -- marked. The value is checked as sent, before the column would round it.
  if exists (
    select 1
    from jsonb_to_recordset(paper_marks -> 'entries') as e (
      student_id uuid, marks numeric, grade text, absent boolean
    )
    where e.student_id is null
      or (
        not coalesce(e.absent, false)
        and (
          (paper.scale = 'marks'
            and (e.marks is null or e.grade is not null or e.marks < 0
              or e.marks > paper.max_marks or e.marks * 2 <> round(e.marks * 2)))
          or (paper.scale = 'grades' and (e.grade is null or e.marks is not null))
        )
      )
  ) then
    raise exception 'A mark is missing, out of range, or not of the paper''s kind.'
      using errcode = '23514';
  end if;

  perform set_config('agla.exam_marks', change_id::text, true);
  roll := private.attendance_roll(paper.class_section_id, paper.held_on);

  delete from public.exam_marks as m
  where m.paper_id = target_id
    and not exists (
      select 1 from jsonb_to_recordset(paper_marks -> 'entries') as e (student_id uuid)
      where e.student_id = m.student_id and e.student_id = any (roll)
    );

  insert into public.exam_marks as m (paper_id, student_id, marks, grade, absent)
  select target_id, e.student_id,
    case when coalesce(e.absent, false) then null else e.marks end,
    case when coalesce(e.absent, false) then null else e.grade end,
    coalesce(e.absent, false)
  from jsonb_to_recordset(paper_marks -> 'entries') as e (
    student_id uuid, marks numeric, grade text, absent boolean
  )
  where e.student_id = any (roll)
  on conflict (paper_id, student_id) do update
  set marks = excluded.marks,
    grade = excluded.grade,
    absent = excluded.absent
  where (m.marks, m.grade, m.absent) is distinct from (excluded.marks, excluded.grade, excluded.absent);

  update public.exam_papers
  set revision = revision + 1, client_change_id = change_id
  where id = target_id
  returning revision into saved;

  perform set_config('agla.exam_marks', '', true);
  return saved;
end;
$$;

comment on function public.save_exam_marks(jsonb) is
  'Saves the marks of one paper, refusing to overwrite marks saved on another device since.';

-- ---------------------------------------------------------------------------------------------
-- Marks beside Pulse
-- ---------------------------------------------------------------------------------------------

-- Each child with a mark in a language paper (from `since`, when given) beside what Pulse heard of
-- them in the paper's month or the month before. A paper in the language the child read in Pulse
-- is set beside their reading; an English paper of a class that read in Hindi, beside their
-- spoken English. The level is the CRP's when they listened, else the engine's when it was sure,
-- else the teacher's own; only the first two are independent of the teacher who gave the marks,
-- and a check with an independent level is preferred to a later one without. Children of the
-- adapted check are left out; their marks rest on other grounds.
create function public.exam_marks_pulse(
  target_paper_id uuid default null,
  since date default null
)
returns table (
  paper_id uuid,
  student_id uuid,
  percent numeric,
  pulse_level text,
  source text,
  check_id uuid
)
language sql
stable
set search_path = ''
as $$
  with papers as (
    select p.id, p.class_section_id, p.held_on, p.max_marks, p.subject
    from public.exam_papers as p
    join public.class_sections as c on c.id = p.class_section_id
    where p.school_id = any (private.crp_school_ids())
      and (target_paper_id is null or p.id = target_paper_id)
      and (since is null or p.held_on >= since)
      and p.subject in ('hindi', 'english')
      and c.grade between 1 and 3
  ),
  heard as (
    select distinct on (papers.id, k.student_id)
      papers.id as paper_id, papers.max_marks, k.student_id, k.id as check_id, measure.kind,
      case measure.kind when 'reading' then r.reading_level else r.english_level end as reviewed,
      case
        when s.check_id is not null
          and not coalesce(s.flags && array['low_confidence', 'no_speech', 'quiet'], false)
        then case measure.kind when 'reading' then s.reading_level else s.english_level end
      end as engine,
      case measure.kind when 'reading' then k.reading_level else k.english_level end as teacher
    from papers
    join public.pulse_checks as k on k.class_section_id = papers.class_section_id
    join public.pulse_samples as sample on sample.id = k.sample_id
    join public.pulse_cycles as cy on cy.id = sample.cycle_id
    cross join lateral (
      select case
        when (cy.language = 'hi' and papers.subject = 'hindi')
          or (cy.language = 'en' and papers.subject = 'english') then 'reading'
        when cy.language = 'hi' and papers.subject = 'english' then 'english'
      end as kind
    ) as measure
    left join public.pulse_reviews as r on r.check_id = k.id
    left join public.pulse_scores as s on s.check_id = k.id
    where measure.kind is not null
      and k.mode = 'recorded'
      and cy.month between (date_trunc('month', papers.held_on) - interval '1 month')::date
        and date_trunc('month', papers.held_on)::date
    order by papers.id, k.student_id,
      (
        r.check_id is not null
        or (
          s.check_id is not null
          and not coalesce(s.flags && array['low_confidence', 'no_speech', 'quiet'], false)
        )
      ) desc,
      cy.month desc,
      k.attempt desc
  )
  select h.paper_id, m.student_id,
    private.mark_percent(m.marks, m.grade, h.max_marks),
    coalesce(h.reviewed, h.engine, h.teacher),
    case
      when h.reviewed is not null then 'review'
      when h.engine is not null then 'engine'
      else 'teacher'
    end,
    h.check_id
  from heard as h
  join public.exam_marks as m
    on m.paper_id = h.paper_id and m.student_id = h.student_id and not m.absent
$$;

comment on function public.exam_marks_pulse(uuid, date) is
  'For CRPs: each child''s mark in a language paper beside the Pulse level heard of them.';

-- For each language paper of the CRP's classes (from `since`, when given), how its marks compare
-- with Pulse, counting only levels independent of the teacher. A paper is flagged when at least
-- three children compare, and at least two, and two in five, of those with high marks (75 % or
-- grade A) were heard reading (or answering in English) at the lowest level.
create function public.exam_marks_checks(since date default null)
returns table (
  paper_id uuid,
  exam_id uuid,
  class_section_id uuid,
  school_id uuid,
  subject text,
  held_on date,
  compared integer,
  high_marks integer,
  high_but_weak integer,
  low_but_strong integer,
  flagged boolean
)
language sql
stable
set search_path = ''
as $$
  with counted as (
    select q.paper_id,
      count(*)::integer as compared,
      count(*) filter (where q.percent >= 75)::integer as high_marks,
      count(*) filter (
        where q.percent >= 75 and q.pulse_level in ('needs_support', 'no_response')
      )::integer as high_but_weak,
      count(*) filter (
        where q.percent < 40 and q.pulse_level in ('fluent', 'sentences')
      )::integer as low_but_strong
    from public.exam_marks_pulse(null, since) as q
    where q.source in ('review', 'engine')
    group by q.paper_id
  )
  select p.id, p.exam_id, p.class_section_id, p.school_id, p.subject, p.held_on,
    c.compared, c.high_marks, c.high_but_weak, c.low_but_strong,
    c.compared >= 3 and c.high_but_weak >= 2 and c.high_but_weak * 5 >= c.high_marks * 2
  from counted as c
  join public.exam_papers as p on p.id = c.paper_id
$$;

comment on function public.exam_marks_checks(date) is
  'For CRPs: how the marks of each language paper compare with Pulse, and whether to talk it over.';

revoke all on function public.save_exam(jsonb) from public, anon;
revoke all on function public.move_exam_paper(uuid, date, smallint) from public, anon;
revoke all on function public.remove_exam(uuid) from public, anon;
revoke all on function public.save_exam_marks(jsonb) from public, anon;
revoke all on function public.exam_marks_pulse(uuid, date) from public, anon;
revoke all on function public.exam_marks_checks(date) from public, anon;
grant execute on function
  public.save_exam(jsonb),
  public.move_exam_paper(uuid, date, smallint),
  public.remove_exam(uuid),
  public.save_exam_marks(jsonb),
  public.exam_marks_pulse(uuid, date),
  public.exam_marks_checks(date)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The week's plan counts papers to talk over
-- ---------------------------------------------------------------------------------------------

-- The plan also counts the class's recent papers whose marks Pulse does not bear out. The result
-- gains a column, so the function is created anew.
drop function public.crp_class_signal();

create function public.crp_class_signal()
returns table (
  class_section_id uuid,
  school_id uuid,
  grade smallint,
  section text,
  medium text,
  pulse_month date,
  pulse_checked integer,
  needs_support integer,
  hesitant integer,
  fluent integer,
  english_no_response integer,
  to_listen integer,
  last_visit_on date,
  visits_this_year integer,
  check_back_on date,
  check_back_visit_id uuid,
  request_topic text,
  requested_at timestamptz,
  marks_to_discuss integer
)
language sql
stable
set search_path = ''
as $$
  with classes as (
    select c.id, c.school_id, c.grade, c.section, c.medium, y.starts_on as year_start
    from public.class_sections as c
    join public.academic_years as y on y.id = c.academic_year_id
    where c.school_id = any (private.crp_school_ids())
      and c.is_active
      and private.today() between y.starts_on and y.ends_on
  ),
  -- The latest attempt of each drawn child, by month.
  latest as (
    select distinct on (k.sample_id)
      k.id, k.class_section_id, cy.month, k.mode, k.reading_level, k.english_level,
      k.audio_deleted_at
    from public.pulse_checks as k
    join public.pulse_samples as s on s.id = k.sample_id
    join public.pulse_cycles as cy on cy.id = s.cycle_id
    join classes on classes.id = k.class_section_id
    where cy.month >= (date_trunc('month', private.today()) - interval '1 month')::date
    order by k.sample_id, k.attempt desc
  ),
  levels as (
    select l.*,
      coalesce(r.reading_level, l.reading_level) as reading,
      coalesce(r.english_level, l.english_level) as english,
      r.check_id is not null as reviewed,
      p.check_id is not null as scored,
      p.reading_level as machine_reading,
      p.english_level as machine_english,
      coalesce(p.flags && array['low_confidence', 'no_speech', 'quiet'], false) as unsure
    from latest as l
    left join public.pulse_reviews as r on r.check_id = l.id
    left join public.pulse_scores as p on p.check_id = l.id
  ),
  months as (
    select l.class_section_id, l.month, count(*)::integer as checked
    from levels as l
    group by l.class_section_id, l.month
  ),
  -- Papers of the last 60 days whose marks Pulse does not bear out.
  marks_flags as (
    select m.class_section_id, count(*)::integer as papers
    from public.exam_marks_checks(private.today() - 60) as m
    where m.flagged
    group by m.class_section_id
  ),
  chosen as (
    select distinct on (m.class_section_id) m.class_section_id, m.month
    from months as m
    order by m.class_section_id,
      (m.month = date_trunc('month', private.today())::date and m.checked >= 5) desc,
      (m.month < date_trunc('month', private.today())::date) desc,
      m.month desc
  )
  select
    classes.id,
    classes.school_id,
    classes.grade,
    classes.section,
    classes.medium,
    chosen.month,
    coalesce(pulse.checked, 0),
    coalesce(pulse.needs_support, 0),
    coalesce(pulse.hesitant, 0),
    coalesce(pulse.fluent, 0),
    coalesce(pulse.english_no_response, 0),
    coalesce(listening.to_listen, 0),
    seen.last_visit_on,
    coalesce(seen.visits_this_year, 0),
    due.check_back_on,
    due.visit_id,
    request.topic,
    request.created_at,
    coalesce(marks_flags.papers, 0)
  from classes
  left join chosen on chosen.class_section_id = classes.id
  left join marks_flags on marks_flags.class_section_id = classes.id
  left join lateral (
    select
      count(*)::integer as checked,
      count(*) filter (where l.reading = 'needs_support')::integer as needs_support,
      count(*) filter (where l.reading = 'hesitant')::integer as hesitant,
      count(*) filter (where l.reading = 'fluent')::integer as fluent,
      count(*) filter (where l.english = 'no_response')::integer as english_no_response
    from levels as l
    where l.class_section_id = classes.id and l.month = chosen.month
  ) as pulse on true
  -- Recordings to listen to, in both months while their audio is kept.
  left join lateral (
    select count(*)::integer as to_listen
    from levels as l
    where l.class_section_id = classes.id
      and l.mode = 'recorded'
      and l.audio_deleted_at is null
      and l.scored
      and not l.reviewed
      and (
        l.unsure
        or l.machine_reading is distinct from l.reading_level
        or (l.english_level, l.machine_english) in
           (('sentences', 'no_response'), ('no_response', 'sentences'))
      )
  ) as listening on true
  left join lateral (
    select max(v.visited_on) as last_visit_on, count(*)::integer as visits_this_year
    from public.visits as v
    where v.class_section_id = classes.id
      and v.status = 'done'
      and v.visited_on >= classes.year_start
  ) as seen on true
  left join lateral (
    -- The latest agreed step of the class that no later visit has followed up.
    select f.check_back_on, v.id as visit_id
    from public.visits as v
    join public.visit_feedback as f on f.visit_id = v.id
    where v.class_section_id = classes.id
      and v.status = 'done'
      and f.agreed_at is not null
      and not exists (
        select 1 from public.visits as later
        where later.follows_visit_id = v.id and later.status = 'done'
      )
    order by v.visited_on desc, v.started_at desc
    limit 1
  ) as due on true
  left join lateral (
    select r.topic, r.created_at
    from public.visit_requests as r
    where r.class_section_id = classes.id
      and r.withdrawn_at is null
      and r.answered_by_visit_id is null
    limit 1
  ) as request on true
  order by classes.school_id, classes.grade, classes.section
$$;

comment on function public.crp_class_signal() is
  'The current classes of the CRP''s schools with what the week''s plan is ranked by.';

grant execute on function public.crp_class_signal() to authenticated;
revoke all on function public.crp_class_signal() from public, anon;
