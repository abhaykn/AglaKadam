-- Administration console: overview figures and bulk imports.
--
-- Imports run with the caller's privileges (row level security applies) and are all-or-nothing:
-- every row is validated first, and if any row has a problem nothing is written and the problems
-- are returned in the error detail as JSON, `[{"row": 3, "field": "udise_code", "issue": "format"}]`,
-- so the console can show them in the user's language. Issue codes: required, format, duplicate,
-- conflict, unknown.

-- ---------------------------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------------------------

create function public.admin_overview()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a super administrator can view the platform overview.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'schools', (select count(*) from public.schools where is_active),
    'clusters', (select count(*) from public.clusters),
    'blocks', (select count(*) from public.blocks),
    'districts', (select count(*) from public.districts),
    'staff', (
      select coalesce(jsonb_object_agg(role, total), '{}'::jsonb)
      from (
        select a.role, count(distinct a.user_id) as total
        from public.staff_assignments as a
        join public.profiles as p on p.id = a.user_id
        where p.is_active
          and a.starts_on <= private.today()
          and (a.ends_on is null or a.ends_on >= private.today())
        group by a.role
      ) as by_role
    ),
    'students', (
      select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
      from (select status, count(*) as total from public.students group by status) as by_status
    ),
    'family_accounts', (
      select count(*) from public.students where auth_user_id is not null and status = 'active'
    ),
    'current_academic_year', (
      select jsonb_build_object('id', id, 'label', label, 'starts_on', starts_on, 'ends_on', ends_on)
      from public.academic_years
      where private.today() between starts_on and ends_on
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- School import
-- ---------------------------------------------------------------------------------------------

-- Normalised rows of a school import file. Codes are trimmed and upper-cased; empty optional values
-- become null.
create function private.parse_school_import(rows jsonb)
returns table (
  line integer,
  state_code text,
  state_name text,
  state_name_hi text,
  district_code text,
  district_name text,
  district_name_hi text,
  block_code text,
  block_name text,
  block_name_hi text,
  cluster_code text,
  cluster_name text,
  cluster_name_hi text,
  udise_code text,
  school_name text,
  school_name_hi text,
  village text
)
language sql
immutable
set search_path = ''
as $$
  select
    item.ordinality::integer,
    nullif(upper(btrim(item.value ->> 'state_code')), ''),
    nullif(btrim(item.value ->> 'state_name'), ''),
    nullif(btrim(item.value ->> 'state_name_hi'), ''),
    nullif(upper(btrim(item.value ->> 'district_code')), ''),
    nullif(btrim(item.value ->> 'district_name'), ''),
    nullif(btrim(item.value ->> 'district_name_hi'), ''),
    nullif(upper(btrim(item.value ->> 'block_code')), ''),
    nullif(btrim(item.value ->> 'block_name'), ''),
    nullif(btrim(item.value ->> 'block_name_hi'), ''),
    nullif(upper(btrim(item.value ->> 'cluster_code')), ''),
    nullif(btrim(item.value ->> 'cluster_name'), ''),
    nullif(btrim(item.value ->> 'cluster_name_hi'), ''),
    nullif(btrim(item.value ->> 'udise_code'), ''),
    nullif(btrim(item.value ->> 'school_name'), ''),
    nullif(btrim(item.value ->> 'school_name_hi'), ''),
    nullif(btrim(item.value ->> 'village'), '')
  from jsonb_array_elements(rows) with ordinality as item (value, ordinality)
$$;

create function private.school_import_problems(rows jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with input as (
    select * from private.parse_school_import(rows)
  ),
  field_checks as (
    select i.line, f.field, f.value, f.pattern, f.max_length
    from input as i
    cross join lateral (
      values
        ('state_code', i.state_code, '^[0-9A-Z]{1,12}$', null::integer),
        ('state_name', i.state_name, null, 120),
        ('district_code', i.district_code, '^[0-9A-Z]{1,12}$', null),
        ('district_name', i.district_name, null, 120),
        ('block_code', i.block_code, '^[0-9A-Z]{1,12}$', null),
        ('block_name', i.block_name, null, 120),
        ('cluster_code', i.cluster_code, '^[0-9A-Z]{1,12}$', null),
        ('cluster_name', i.cluster_name, null, 120),
        ('udise_code', i.udise_code, '^[0-9]{11}$', null),
        ('school_name', i.school_name, null, 160)
    ) as f (field, value, pattern, max_length)
  ),
  optional_checks as (
    select i.line, f.field, f.value, f.max_length
    from input as i
    cross join lateral (
      values
        ('state_name_hi', i.state_name_hi, 120),
        ('district_name_hi', i.district_name_hi, 120),
        ('block_name_hi', i.block_name_hi, 120),
        ('cluster_name_hi', i.cluster_name_hi, 120),
        ('school_name_hi', i.school_name_hi, 160),
        ('village', i.village, 120)
    ) as f (field, value, max_length)
  ),
  problems as (
    select line, field, 'required' as issue from field_checks where value is null
    union all
    select line, field, 'format' from field_checks
    where value is not null
      and ((pattern is not null and value !~ pattern)
           or (max_length is not null and char_length(value) > max_length))
    union all
    select line, field, 'format' from optional_checks
    where value is not null and char_length(value) > max_length
    union all
    -- The same school listed twice.
    select line, 'udise_code', 'duplicate'
    from (select line, count(*) over (partition by udise_code) as copies
          from input where udise_code is not null) as counted
    where copies > 1
    -- The same code given different names in one file.
    union all
    select min(line), 'state_name', 'conflict' from input
    where state_code is not null group by state_code having count(distinct state_name) > 1
    union all
    select min(line), 'district_name', 'conflict' from input
    where district_code is not null
    group by state_code, district_code having count(distinct district_name) > 1
    union all
    select min(line), 'block_name', 'conflict' from input
    where block_code is not null
    group by state_code, district_code, block_code having count(distinct block_name) > 1
    union all
    select min(line), 'cluster_name', 'conflict' from input
    where cluster_code is not null
    group by state_code, district_code, block_code, cluster_code
    having count(distinct cluster_name) > 1
    -- The same for the optional Hindi names: one code, one name.
    union all
    select min(line), 'state_name_hi', 'conflict' from input
    where state_code is not null group by state_code having count(distinct state_name_hi) > 1
    union all
    select min(line), 'district_name_hi', 'conflict' from input
    where district_code is not null
    group by state_code, district_code having count(distinct district_name_hi) > 1
    union all
    select min(line), 'block_name_hi', 'conflict' from input
    where block_code is not null
    group by state_code, district_code, block_code having count(distinct block_name_hi) > 1
    union all
    select min(line), 'cluster_name_hi', 'conflict' from input
    where cluster_code is not null
    group by state_code, district_code, block_code, cluster_code
    having count(distinct cluster_name_hi) > 1
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('row', line, 'field', field, 'issue', issue)
              order by line, field),
    '[]'::jsonb
  )
  from (select distinct line, field, issue from problems order by line, field limit 200) as limited
$$;

create function public.import_schools(rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  problems jsonb;
  states_result jsonb;
  districts_result jsonb;
  blocks_result jsonb;
  clusters_result jsonb;
  schools_result jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'Only a super administrator can import schools.' using errcode = '42501';
  end if;

  if rows is null or jsonb_typeof(rows) <> 'array'
     or jsonb_array_length(rows) not between 1 and 5000
  then
    raise exception 'An import must contain between 1 and 5000 rows.' using errcode = '22023';
  end if;

  problems := private.school_import_problems(rows);
  if jsonb_array_length(problems) > 0 then
    raise exception 'The file has problems; nothing was imported.'
      using errcode = '22023', detail = problems::text, hint = 'import_problems';
  end if;

  with upserted as (
    insert into public.states (code, name_en, name_hi)
    select distinct on (state_code) state_code, state_name, state_name_hi
    from private.parse_school_import(rows)
    order by state_code, line
    on conflict (code) do update
    set name_en = excluded.name_en,
        name_hi = coalesce(excluded.name_hi, public.states.name_hi)
    where (public.states.name_en, public.states.name_hi)
          is distinct from (excluded.name_en, coalesce(excluded.name_hi, public.states.name_hi))
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object('created', count(*) filter (where inserted),
                            'updated', count(*) filter (where not inserted))
  into states_result
  from upserted;

  with upserted as (
    insert into public.districts (state_id, code, name_en, name_hi)
    select distinct on (s.id, i.district_code) s.id, i.district_code, i.district_name, i.district_name_hi
    from private.parse_school_import(rows) as i
    join public.states as s on s.code = i.state_code
    order by s.id, i.district_code, i.line
    on conflict (state_id, code) do update
    set name_en = excluded.name_en,
        name_hi = coalesce(excluded.name_hi, public.districts.name_hi)
    where (public.districts.name_en, public.districts.name_hi)
          is distinct from (excluded.name_en, coalesce(excluded.name_hi, public.districts.name_hi))
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object('created', count(*) filter (where inserted),
                            'updated', count(*) filter (where not inserted))
  into districts_result
  from upserted;

  with upserted as (
    insert into public.blocks (district_id, code, name_en, name_hi)
    select distinct on (d.id, i.block_code) d.id, i.block_code, i.block_name, i.block_name_hi
    from private.parse_school_import(rows) as i
    join public.states as s on s.code = i.state_code
    join public.districts as d on d.state_id = s.id and d.code = i.district_code
    order by d.id, i.block_code, i.line
    on conflict (district_id, code) do update
    set name_en = excluded.name_en,
        name_hi = coalesce(excluded.name_hi, public.blocks.name_hi)
    where (public.blocks.name_en, public.blocks.name_hi)
          is distinct from (excluded.name_en, coalesce(excluded.name_hi, public.blocks.name_hi))
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object('created', count(*) filter (where inserted),
                            'updated', count(*) filter (where not inserted))
  into blocks_result
  from upserted;

  with upserted as (
    insert into public.clusters (block_id, code, name_en, name_hi)
    select distinct on (b.id, i.cluster_code) b.id, i.cluster_code, i.cluster_name, i.cluster_name_hi
    from private.parse_school_import(rows) as i
    join public.states as s on s.code = i.state_code
    join public.districts as d on d.state_id = s.id and d.code = i.district_code
    join public.blocks as b on b.district_id = d.id and b.code = i.block_code
    order by b.id, i.cluster_code, i.line
    on conflict (block_id, code) do update
    set name_en = excluded.name_en,
        name_hi = coalesce(excluded.name_hi, public.clusters.name_hi)
    where (public.clusters.name_en, public.clusters.name_hi)
          is distinct from (excluded.name_en, coalesce(excluded.name_hi, public.clusters.name_hi))
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object('created', count(*) filter (where inserted),
                            'updated', count(*) filter (where not inserted))
  into clusters_result
  from upserted;

  with upserted as (
    insert into public.schools (cluster_id, udise_code, name_en, name_hi, village)
    select c.id, i.udise_code, i.school_name, i.school_name_hi, i.village
    from private.parse_school_import(rows) as i
    join public.states as s on s.code = i.state_code
    join public.districts as d on d.state_id = s.id and d.code = i.district_code
    join public.blocks as b on b.district_id = d.id and b.code = i.block_code
    join public.clusters as c on c.block_id = b.id and c.code = i.cluster_code
    on conflict (udise_code) do update
    set cluster_id = excluded.cluster_id,
        name_en = excluded.name_en,
        name_hi = coalesce(excluded.name_hi, public.schools.name_hi),
        village = coalesce(excluded.village, public.schools.village)
    where (public.schools.cluster_id, public.schools.name_en, public.schools.name_hi,
           public.schools.village)
          is distinct from
          (excluded.cluster_id, excluded.name_en, coalesce(excluded.name_hi, public.schools.name_hi),
           coalesce(excluded.village, public.schools.village))
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object('created', count(*) filter (where inserted),
                            'updated', count(*) filter (where not inserted))
  into schools_result
  from upserted;

  return jsonb_build_object(
    'rows', jsonb_array_length(rows),
    'states', states_result,
    'districts', districts_result,
    'blocks', blocks_result,
    'clusters', clusters_result,
    'schools', schools_result
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Student import
-- ---------------------------------------------------------------------------------------------

create function private.parse_student_import(rows jsonb)
returns table (
  line integer,
  full_name text,
  gender text,
  date_of_birth_text text,
  admission_number text,
  grade_text text,
  section text,
  special_needs_text text
)
language sql
immutable
set search_path = ''
as $$
  select
    item.ordinality::integer,
    nullif(btrim(item.value ->> 'full_name'), ''),
    nullif(lower(btrim(item.value ->> 'gender')), ''),
    nullif(btrim(item.value ->> 'date_of_birth'), ''),
    nullif(btrim(item.value ->> 'admission_number'), ''),
    nullif(btrim(item.value ->> 'grade'), ''),
    coalesce(nullif(upper(btrim(item.value ->> 'section')), ''), 'A'),
    nullif(lower(btrim(item.value ->> 'has_special_needs')), '')
  from jsonb_array_elements(rows) with ordinality as item (value, ordinality)
$$;

create function private.student_import_problems(rows jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  problems jsonb;
begin
  with input as (
    select * from private.parse_student_import(rows)
  ),
  issues as (
    select line, 'full_name' as field, 'required' as issue from input where full_name is null
    union all
    select line, 'full_name', 'format' from input
    where full_name is not null and char_length(full_name) > 120
    union all
    select line, 'gender', 'required' from input where gender is null
    union all
    select line, 'gender', 'format' from input
    where gender is not null and gender not in ('female', 'male', 'transgender')
    union all
    select line, 'date_of_birth', 'format' from input
    where date_of_birth_text is not null
      and (date_of_birth_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           or private.safe_date(date_of_birth_text) is null
           or private.safe_date(date_of_birth_text) < date '2005-01-01'
           or private.safe_date(date_of_birth_text) > private.today())
    union all
    select line, 'admission_number', 'format' from input
    where admission_number is not null and char_length(admission_number) > 30
    union all
    select line, 'admission_number', 'duplicate'
    from (select line, count(*) over (partition by admission_number) as copies
          from input where admission_number is not null) as counted
    where copies > 1
    union all
    select line, 'grade', 'required' from input where grade_text is null
    union all
    select line, 'grade', 'format' from input
    where grade_text is not null and grade_text !~ '^[0-8]$'
    union all
    select line, 'section', 'format' from input where section !~ '^[A-Z0-9]{1,3}$'
    union all
    select line, 'has_special_needs', 'format' from input
    where special_needs_text is not null
      and special_needs_text not in ('yes', 'no', 'true', 'false', '1', '0')
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('row', line, 'field', field, 'issue', issue) order by line, field),
    '[]'::jsonb
  )
  into problems
  from (select distinct line, field, issue from issues order by line, field limit 200) as limited;

  return problems;
end;
$$;

-- Date from text, or null when the text is not a valid calendar date.
create function private.safe_date(value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::date;
exception
  when others then
    return null;
end;
$$;

-- Imports verified students into one school for one academic year, creating any missing class
-- sections and enrolling each student. Students whose admission number already exists in the school
-- are skipped and reported. Available to super administrators and the school's CRP; guardian details
-- are added afterwards by the school's teachers.
create function public.import_students(target_school_id uuid, target_academic_year_id uuid, rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  problems jsonb;
  prepared jsonb;
  skipped integer;
  sections_created integer;
  students_created integer;
begin
  if not (private.is_super_admin() or target_school_id = any (private.crp_school_ids())) then
    raise exception 'Only a super administrator or the cluster resource person can import students into this school.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.schools where id = target_school_id and is_active) then
    raise exception 'The school does not exist or is inactive.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.academic_years where id = target_academic_year_id) then
    raise exception 'The academic year does not exist.' using errcode = '22023';
  end if;

  if rows is null or jsonb_typeof(rows) <> 'array'
     or jsonb_array_length(rows) not between 1 and 2000
  then
    raise exception 'An import must contain between 1 and 2000 rows.' using errcode = '22023';
  end if;

  problems := private.student_import_problems(rows);
  if jsonb_array_length(problems) > 0 then
    raise exception 'The file has problems; nothing was imported.'
      using errcode = '22023', detail = problems::text, hint = 'import_problems';
  end if;

  select count(*)
  into skipped
  from private.parse_student_import(rows) as i
  where i.admission_number is not null
    and exists (
      select 1 from public.students as s
      where s.school_id = target_school_id and s.admission_number = i.admission_number
    );

  -- New students with their identifiers decided up front, so that the enrolments can be written in
  -- a separate statement once the student rows exist.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', gen_random_uuid(),
           'full_name', i.full_name,
           'gender', i.gender,
           'date_of_birth', i.date_of_birth_text,
           'admission_number', i.admission_number,
           'grade', i.grade_text::smallint,
           'section', i.section,
           'has_special_needs', coalesce(i.special_needs_text in ('yes', 'true', '1'), false)
         ) order by i.line), '[]'::jsonb)
  into prepared
  from private.parse_student_import(rows) as i
  where i.admission_number is null
     or not exists (
       select 1 from public.students as s
       where s.school_id = target_school_id and s.admission_number = i.admission_number
     );

  with created as (
    insert into public.class_sections (school_id, academic_year_id, grade, section)
    select distinct target_school_id, target_academic_year_id, p.grade, p.section
    from jsonb_to_recordset(prepared) as p (grade smallint, section text)
    on conflict (school_id, academic_year_id, grade, section) do nothing
    returning id
  )
  select count(*) into sections_created from created;

  if exists (
    select 1
    from jsonb_to_recordset(prepared) as p (grade smallint, section text)
    join public.class_sections as cs
      on cs.school_id = target_school_id
     and cs.academic_year_id = target_academic_year_id
     and cs.grade = p.grade
     and cs.section = p.section
    where not cs.is_active
  ) then
    raise exception 'A class in the file is marked inactive. Reactivate it before importing.'
      using errcode = '22023';
  end if;

  insert into public.students (
    id, school_id, full_name, gender, date_of_birth, admission_number, has_special_needs, status
  )
  select p.id, target_school_id, p.full_name, p.gender, p.date_of_birth::date, p.admission_number,
         p.has_special_needs, 'active'
  from jsonb_to_recordset(prepared) as p (
    id uuid, full_name text, gender text, date_of_birth text, admission_number text,
    has_special_needs boolean
  );
  get diagnostics students_created = row_count;

  insert into public.enrolments (student_id, class_section_id)
  select p.id, cs.id
  from jsonb_to_recordset(prepared) as p (id uuid, grade smallint, section text)
  join public.class_sections as cs
    on cs.school_id = target_school_id
   and cs.academic_year_id = target_academic_year_id
   and cs.grade = p.grade
   and cs.section = p.section;

  return jsonb_build_object(
    'rows', jsonb_array_length(rows),
    'created', students_created,
    'skipped_existing', skipped,
    'classes_created', sections_created
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------------------------

-- Moves a person from one posting to another in a single step: the current assignment ends the day
-- before `effective_on` and the new one starts on that day. Either both happen or neither does.
-- `new_scope_id` is omitted for a super administrator posting, which has no scope.
create function public.transfer_assignment(
  assignment_id uuid,
  new_role public.staff_role,
  effective_on date,
  new_scope_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  current_assignment public.staff_assignments%rowtype;
  new_assignment_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'Only a super administrator can transfer staff.' using errcode = '42501';
  end if;

  select * into current_assignment
  from public.staff_assignments
  where id = assignment_id
  for update;

  if not found or current_assignment.ends_on is not null then
    raise exception 'The assignment does not exist or has already ended.' using errcode = '22023';
  end if;

  if effective_on is null or effective_on < current_assignment.starts_on then
    raise exception 'The transfer date cannot be before the current assignment started.'
      using errcode = '22023';
  end if;

  if new_role <> 'super_admin' and new_scope_id is null then
    raise exception 'The % role requires a scope.', new_role using errcode = '22023';
  end if;

  if new_role = 'teacher'
     and not exists (select 1 from public.schools where id = new_scope_id and is_active)
  then
    raise exception 'Teachers can only be posted to an active school.' using errcode = '22023';
  end if;

  update public.staff_assignments
  set ends_on = effective_on - 1
  where id = assignment_id;

  insert into public.staff_assignments (
    user_id, role, district_id, block_id, cluster_id, school_id, starts_on
  )
  values (
    current_assignment.user_id,
    new_role,
    case when new_role = 'district_officer' then new_scope_id end,
    case when new_role = 'block_officer' then new_scope_id end,
    case when new_role = 'crp' then new_scope_id end,
    case when new_role = 'teacher' then new_scope_id end,
    effective_on
  )
  returning id into new_assignment_id;

  return new_assignment_id;
end;
$$;

revoke all on function public.transfer_assignment(uuid, public.staff_role, date, uuid) from public, anon;
grant execute on function public.transfer_assignment(uuid, public.staff_role, date, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- School figures for CRPs and teachers
-- ---------------------------------------------------------------------------------------------

-- One row per school the caller works in (a CRP's cluster schools, a teacher's school), with figures
-- counted on the server so that a phone on a slow connection receives a handful of numbers instead
-- of every student record. Runs with the caller's privileges.
create function public.my_schools_overview()
returns table (
  school_id uuid,
  udise_code text,
  name_en text,
  name_hi text,
  cluster_id uuid,
  active_students bigint,
  pending_students bigint,
  teachers bigint,
  current_classes bigint
)
language sql
stable
set search_path = ''
as $$
  select
    s.id,
    s.udise_code,
    s.name_en,
    s.name_hi,
    s.cluster_id,
    (select count(*) from public.students as st where st.school_id = s.id and st.status = 'active'),
    (select count(*) from public.students as st where st.school_id = s.id and st.status = 'pending'),
    (select count(distinct a.user_id)
     from public.staff_assignments as a
     where a.school_id = s.id
       and a.role = 'teacher'
       and a.starts_on <= private.today()
       and (a.ends_on is null or a.ends_on >= private.today())),
    (select count(*)
     from public.class_sections as cs
     join public.academic_years as y on y.id = cs.academic_year_id
     where cs.school_id = s.id
       and cs.is_active
       and private.today() between y.starts_on and y.ends_on)
  from public.schools as s
  where s.id = any (private.staff_school_ids())
  order by s.name_en
$$;

revoke all on function public.my_schools_overview() from public, anon;
grant execute on function public.my_schools_overview() to authenticated, service_role;

revoke all on function public.admin_overview() from public, anon;
revoke all on function public.import_schools(jsonb) from public, anon;
revoke all on function public.import_students(uuid, uuid, jsonb) from public, anon;
revoke all on function private.parse_school_import(jsonb) from public;
revoke all on function private.school_import_problems(jsonb) from public;
revoke all on function private.parse_student_import(jsonb) from public;
revoke all on function private.student_import_problems(jsonb) from public;
revoke all on function private.safe_date(text) from public;

grant execute on function public.admin_overview() to authenticated, service_role;
grant execute on function public.import_schools(jsonb) to authenticated, service_role;
grant execute on function public.import_students(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function
  private.parse_school_import(jsonb),
  private.school_import_problems(jsonb),
  private.parse_student_import(jsonb),
  private.student_import_problems(jsonb),
  private.safe_date(text)
  to authenticated, service_role;
