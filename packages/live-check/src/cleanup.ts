/**
 * Removal of everything a live check creates.
 *
 * Every run marks its records: the state code is `LC` + four capital letters + `S` and the state
 * name starts with "Live check"; the temporary administrator's email is
 * `live-check-xxxx@agla-kadam.invalid`. Everything else hangs off these: the districts, blocks,
 * clusters and schools under the state, the classes and students of those schools, the staff posted
 * to them and the family accounts of those students. The same statement therefore also removes what
 * an interrupted earlier run left behind.
 *
 * The removal is a single transaction, so it either removes everything or nothing. It includes the
 * audit history of these records, so the administration console shows no trace of the check.
 * Pulse recordings are files, which only the Storage API can delete; the run removes its own before
 * this statement, and the daily retention job removes any an interrupted run left behind.
 */

const STATE_CODE_PATTERN = '^LC[A-Z]{4}S$';
const STATE_NAME_PATTERN = 'Live check % state';
const ADMIN_EMAIL_PATTERN = '^live-check-[a-z]{4}@agla-kadam\\.invalid$';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_TEXT = /^[A-Za-z0-9@._-]+$/;

function text(value: string): string {
  if (!SAFE_TEXT.test(value)) {
    throw new Error(`Refusing to place an unexpected value in SQL: ${JSON.stringify(value)}`);
  }
  return `'${value}'`;
}

function uuid(value: string): string {
  if (!UUID.test(value)) {
    throw new Error(`Refusing to place an unexpected identifier in SQL: ${JSON.stringify(value)}`);
  }
  return `'${value}'::uuid`;
}

function textArray(values: readonly string[]): string {
  return `array[${values.map(text).join(', ')}]::text[]`;
}

export interface RunRecords {
  /** Sign-in emails of the staff accounts this run tried to create. */
  staffEmails: string[];
  /**
   * The academic session, when this run created it. Sessions an interrupted run added are found
   * through the audit history, which names the temporary administrator who added them. Either is
   * removed only while no class uses it.
   */
  createdAcademicYearId: string | null;
}

export function cleanupSql(run: RunRecords): string {
  const academicYear = run.createdAcademicYearId;
  return `
begin;

create temporary table lc_states on commit drop as
  select id from public.states
  where code ~ '${STATE_CODE_PATTERN}' and name_en like '${STATE_NAME_PATTERN}';
create temporary table lc_districts on commit drop as
  select id from public.districts where state_id in (select id from lc_states);
create temporary table lc_blocks on commit drop as
  select id from public.blocks where district_id in (select id from lc_districts);
create temporary table lc_clusters on commit drop as
  select id from public.clusters where block_id in (select id from lc_blocks);
create temporary table lc_schools on commit drop as
  select id from public.schools where cluster_id in (select id from lc_clusters);
create temporary table lc_sections on commit drop as
  select id from public.class_sections where school_id in (select id from lc_schools);
create temporary table lc_students on commit drop as
  select id, auth_user_id from public.students where school_id in (select id from lc_schools);
create temporary table lc_users on commit drop as
  select id from auth.users
  where email ~ '${ADMIN_EMAIL_PATTERN}' or email = any (${textArray(run.staffEmails)})
  union
  select user_id from public.staff_assignments
  where school_id in (select id from lc_schools)
     or cluster_id in (select id from lc_clusters)
     or block_id in (select id from lc_blocks)
     or district_id in (select id from lc_districts)
  union
  select auth_user_id from lc_students where auth_user_id is not null;
create temporary table lc_years on commit drop as
  select y.id from public.academic_years as y
  where y.id::text in (
      select a.record_id from public.audit_events as a
      where a.table_name = 'academic_years'
        and a.operation = 'INSERT'
        and a.actor_id in (select id from lc_users)
    )${
      academicYear
        ? `
    or y.id = ${uuid(academicYear)}`
        : ''
    };
create temporary table lc_records on commit drop as
  select id::text as id from lc_states
  union all select id::text from lc_districts
  union all select id::text from lc_blocks
  union all select id::text from lc_clusters
  union all select id::text from lc_schools
  union all select id::text from lc_sections
  union all select id::text from lc_students
  union all select id::text from lc_users
  union all select id::text from public.staff_assignments where user_id in (select id from lc_users)
  union all select id::text from public.enrolments where student_id in (select id from lc_students)
  union all select id::text from public.guardian_consents where student_id in (select id from lc_students)
  union all select id::text from public.attendance_sessions where class_section_id in (select id from lc_sections)
  union all select id::text from public.pulse_cycles where class_section_id in (select id from lc_sections)
  union all select id::text from lc_years;

delete from public.guardian_consents where student_id in (select id from lc_students);
-- Visits hold their observations, coaching and voice notes; classes cannot go while they exist.
-- Exams hold papers of the run's classes, with their marks and history.
delete from public.exams
  where school_id in (select id from lc_schools) or cluster_id in (select id from lc_clusters);
delete from public.visits where class_section_id in (select id from lc_sections);
delete from public.class_notes where class_section_id in (select id from lc_sections);
-- Removed notes are remembered so that a resend cannot bring them back; the run's go with them.
delete from private.class_note_removals where class_section_id in (select id from lc_sections);
delete from public.visit_requests where class_section_id in (select id from lc_sections);
delete from public.crp_tasks where cluster_id in (select id from lc_clusters);
delete from public.attendance_sessions where class_section_id in (select id from lc_sections);
delete from public.pulse_checks where class_section_id in (select id from lc_sections);
-- Drawn children and their absences go with their cycle.
delete from public.pulse_cycles where class_section_id in (select id from lc_sections);
delete from public.students where id in (select id from lc_students);
delete from public.class_sections where id in (select id from lc_sections);
-- Sahayak's daily counts of the run's accounts.
delete from private.ai_usage where profile_id in (select id from lc_users);
delete from auth.users where id in (select id from lc_users);
delete from public.schools where id in (select id from lc_schools);
delete from public.clusters where id in (select id from lc_clusters);
delete from public.blocks where id in (select id from lc_blocks);
delete from public.districts where id in (select id from lc_districts);
delete from public.states where id in (select id from lc_states);
delete from public.academic_years as y
where y.id in (select id from lc_years)
  and not exists (select 1 from public.class_sections as cs where cs.academic_year_id = y.id);
delete from public.audit_events
where record_id in (select id from lc_records)
   or actor_id in (select id from lc_users)
   or changes ->> 'student_id' in (select id::text from lc_students)
   or changes ->> 'class_section_id' in (select id::text from lc_sections)
   or changes ->> 'teacher_id' in (select id::text from lc_users);

commit;
`;
}

/**
 * The files of class notes kept for the classes of any live check, to be removed through the
 * Storage API before the records: no job removes them later.
 */
export function classNoteFilesSql(): string {
  return `
select o.name
from storage.objects as o
where o.bucket_id = 'class-notes'
  and split_part(o.name, '/', 1) in (
    select cs.id::text
    from public.class_sections as cs
    join public.schools as s on s.id = cs.school_id
    join public.clusters as c on c.id = s.cluster_id
    join public.blocks as b on b.id = c.block_id
    join public.districts as d on d.id = b.district_id
    join public.states as st on st.id = d.state_id
    where st.code ~ '${STATE_CODE_PATTERN}' and st.name_en like '${STATE_NAME_PATTERN}'
  );
`;
}

export interface Leftovers {
  states: number;
  schools: number;
  accounts: number;
  auditEvents: number;
}

/** Counts what is left of any live check; all zero after a successful removal. */
export function leftoversSql(run: RunRecords, userIds: readonly string[]): string {
  const ids = userIds.map(uuid).join(', ');
  return `
select
  (select count(*) from public.states
   where code ~ '${STATE_CODE_PATTERN}' and name_en like '${STATE_NAME_PATTERN}') as states,
  (select count(*) from public.schools as s
   join public.clusters as c on c.id = s.cluster_id
   where c.code ~ '^LC[A-Z]{4}C$') as schools,
  (select count(*) from auth.users
   where email ~ '${ADMIN_EMAIL_PATTERN}'
      or email = any (${textArray(run.staffEmails)})
      or id = any (array[${ids}]::uuid[])) as accounts,
  (select count(*) from public.audit_events
   where actor_id = any (array[${ids}]::uuid[])
      or record_id = any (array[${ids}]::uuid[]::text[])) as audit_events;
`;
}

export function toLeftovers(row: Record<string, unknown> | undefined): Leftovers {
  const count = (key: string) => Number(row?.[key] ?? Number.NaN);
  return {
    states: count('states'),
    schools: count('schools'),
    accounts: count('accounts'),
    auditEvents: count('audit_events'),
  };
}
