import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, type TestDatabase } from './support/database';
import { asUser, createScenario, type Scenario } from './support/scenario';

let database: TestDatabase;
let scenario: Scenario;

beforeAll(async () => {
  database = await createTestDatabase();
  scenario = await createScenario(database);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.begin();
});

afterEach(async () => {
  await database.rollback();
});

interface ImportProblem {
  row: number;
  field: string;
  issue: string;
}

/** Runs an import as the given user and returns either its summary or the reported problems. */
async function runImport(
  userId: string,
  sql: string,
  params: unknown[],
): Promise<{ summary?: Record<string, unknown>; problems?: ImportProblem[]; code?: string }> {
  try {
    const [row] = await database.as(asUser(userId), (query) =>
      query<{ summary: Record<string, unknown> }>(sql, params),
    );
    return row ? { summary: row.summary } : {};
  } catch (error) {
    const failure = error as { code?: string; detail?: string; hint?: string };
    if (failure.hint === 'import_problems' && failure.detail) {
      return { problems: JSON.parse(failure.detail) as ImportProblem[], code: failure.code ?? '' };
    }
    return { code: failure.code ?? '' };
  }
}

function schoolRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    state_code: '09',
    state_name: 'State',
    district_code: '0901',
    district_name: 'District',
    block_code: '090101',
    block_name: 'North',
    cluster_code: '0901010003',
    cluster_name: 'New Cluster',
    udise_code: '09010100301',
    school_name: 'New School',
    ...overrides,
  };
}

const importSchools = (userId: string, rows: unknown[]) =>
  runImport(userId, 'select public.import_schools($1::jsonb) as summary', [JSON.stringify(rows)]);

describe('admin_overview', () => {
  it('reports figures computed from the records', async () => {
    const [row] = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ overview: Record<string, unknown> }>('select public.admin_overview() as overview'),
    );
    expect(row?.overview).toMatchObject({
      schools: 4,
      clusters: 3,
      blocks: 2,
      districts: 1,
      staff: { super_admin: 1, district_officer: 1, block_officer: 1, crp: 2, teacher: 4 },
      students: { active: 4, pending: 1 },
      family_accounts: 1,
      current_academic_year: { id: scenario.academicYearId },
    });
  });

  it('is refused to anyone but a super administrator', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) => query('select public.admin_overview()')),
    );
    expect(code).toBe('42501');
  });
});

describe('school import', () => {
  it('creates missing levels and schools and reuses existing ones', async () => {
    const result = await importSchools(scenario.staff.superAdmin, [
      schoolRow(),
      schoolRow({ udise_code: '09010100302', school_name: 'Second New School' }),
    ]);
    expect(result.summary).toEqual({
      rows: 2,
      states: { created: 0, updated: 0 },
      districts: { created: 0, updated: 0 },
      blocks: { created: 0, updated: 0 },
      clusters: { created: 1, updated: 0 },
      schools: { created: 2, updated: 0 },
    });
  });

  it('updates changed names and moves a school to another cluster', async () => {
    const result = await importSchools(scenario.staff.superAdmin, [
      schoolRow({
        cluster_code: '0901010002',
        cluster_name: 'Cluster 0901010002',
        udise_code: '09010100101',
        school_name: 'School A1 Renamed',
      }),
    ]);
    expect(result.summary).toMatchObject({ schools: { created: 0, updated: 1 } });
    const [school] = await database.query<{ cluster_id: string; name_en: string }>(
      'select cluster_id, name_en from public.schools where id = $1',
      [scenario.schoolA1Id],
    );
    expect(school).toEqual({ cluster_id: scenario.clusterBId, name_en: 'School A1 Renamed' });
  });

  it('reports every problem with its row and writes nothing', async () => {
    const result = await importSchools(scenario.staff.superAdmin, [
      schoolRow({ udise_code: '123' }),
      schoolRow({ udise_code: '09010100302', school_name: '' }),
      schoolRow({ udise_code: '09010100303', cluster_name: 'Different Name' }),
      schoolRow({ udise_code: '09010100303' }),
    ]);
    expect(result.code).toBe('22023');
    expect(result.problems).toEqual([
      { row: 1, field: 'cluster_name', issue: 'conflict' },
      { row: 1, field: 'udise_code', issue: 'format' },
      { row: 2, field: 'school_name', issue: 'required' },
      { row: 3, field: 'udise_code', issue: 'duplicate' },
      { row: 4, field: 'udise_code', issue: 'duplicate' },
    ]);
    const [count] = await database.query<{ total: number }>(
      'select count(*)::int as total from public.clusters',
    );
    expect(count?.total).toBe(3);
  });

  it('reports a code given two different Hindi names', async () => {
    const result = await importSchools(scenario.staff.superAdmin, [
      schoolRow({ cluster_name_hi: 'नया संकुल' }),
      schoolRow({ udise_code: '09010100302', cluster_name_hi: 'दूसरा नाम' }),
    ]);
    expect(result.problems).toEqual([{ row: 1, field: 'cluster_name_hi', issue: 'conflict' }]);
  });

  it('is refused to anyone but a super administrator', async () => {
    const result = await importSchools(scenario.staff.crpA, [schoolRow()]);
    expect(result.code).toBe('42501');
  });

  it('rejects an empty file', async () => {
    const result = await importSchools(scenario.staff.superAdmin, []);
    expect(result.code).toBe('22023');
  });
});

describe('student import', () => {
  const importStudents = (userId: string, schoolId: string, rows: unknown[]) =>
    runImport(userId, 'select public.import_students($1, $2, $3::jsonb) as summary', [
      schoolId,
      scenario.academicYearId,
      JSON.stringify(rows),
    ]);

  it('creates verified students, their classes and enrolments', async () => {
    const result = await importStudents(scenario.staff.crpA, scenario.schoolA2Id, [
      { full_name: 'Ravi Kumar', gender: 'male', grade: '1', admission_number: 'A-1' },
      { full_name: 'Sita Devi', gender: 'Female', grade: '1', date_of_birth: '2019-07-15' },
      {
        full_name: 'Mohan Lal',
        gender: 'male',
        grade: '2',
        section: 'b',
        has_special_needs: 'yes',
      },
    ]);
    expect(result.summary).toEqual({
      rows: 3,
      created: 3,
      skipped_existing: 0,
      classes_created: 2,
    });

    const students = await database.query<{
      full_name: string;
      status: string;
      verified_by: string;
      grade: number;
      section: string;
      has_special_needs: boolean;
    }>(
      `select s.full_name, s.status, s.verified_by, cs.grade, cs.section, s.has_special_needs
       from public.students as s
       join public.enrolments as e on e.student_id = s.id and e.ended_on is null
       join public.class_sections as cs on cs.id = e.class_section_id
       where s.school_id = $1 order by s.full_name`,
      [scenario.schoolA2Id],
    );
    expect(students).toEqual([
      {
        full_name: 'Mohan Lal',
        status: 'active',
        verified_by: scenario.staff.crpA,
        grade: 2,
        section: 'B',
        has_special_needs: true,
      },
      {
        full_name: 'Ravi Kumar',
        status: 'active',
        verified_by: scenario.staff.crpA,
        grade: 1,
        section: 'A',
        has_special_needs: false,
      },
      {
        full_name: 'Sita Devi',
        status: 'active',
        verified_by: scenario.staff.crpA,
        grade: 1,
        section: 'A',
        has_special_needs: false,
      },
    ]);
  });

  it('skips students whose admission number already exists', async () => {
    await importStudents(scenario.staff.superAdmin, scenario.schoolA2Id, [
      { full_name: 'Ravi Kumar', gender: 'male', grade: '1', admission_number: 'A-1' },
    ]);
    const result = await importStudents(scenario.staff.superAdmin, scenario.schoolA2Id, [
      { full_name: 'Ravi Kumar', gender: 'male', grade: '1', admission_number: 'A-1' },
      { full_name: 'New Child', gender: 'female', grade: '1', admission_number: 'A-2' },
    ]);
    expect(result.summary).toMatchObject({ created: 1, skipped_existing: 1, classes_created: 0 });
  });

  it('reports problems with row numbers and writes nothing', async () => {
    const result = await importStudents(scenario.staff.crpA, scenario.schoolA2Id, [
      { full_name: '', gender: 'boy', grade: '9' },
      { full_name: 'Valid Name', gender: 'female', grade: '1', date_of_birth: '2019-02-30' },
      { full_name: 'Twin', gender: 'female', grade: '1', admission_number: 'X' },
      { full_name: 'Twin Two', gender: 'female', grade: '1', admission_number: 'X' },
    ]);
    expect(result.problems).toEqual([
      { row: 1, field: 'full_name', issue: 'required' },
      { row: 1, field: 'gender', issue: 'format' },
      { row: 1, field: 'grade', issue: 'format' },
      { row: 2, field: 'date_of_birth', issue: 'format' },
      { row: 3, field: 'admission_number', issue: 'duplicate' },
      { row: 4, field: 'admission_number', issue: 'duplicate' },
    ]);
    const [count] = await database.query<{ total: number }>(
      'select count(*)::int as total from public.students where school_id = $1',
      [scenario.schoolA2Id],
    );
    expect(count?.total).toBe(0);
  });

  it('is refused to teachers and to CRPs of other clusters', async () => {
    const row = [{ full_name: 'Someone', gender: 'male', grade: '1' }];
    expect((await importStudents(scenario.staff.teacherA2, scenario.schoolA2Id, row)).code).toBe(
      '42501',
    );
    expect((await importStudents(scenario.staff.crpB, scenario.schoolA2Id, row)).code).toBe(
      '42501',
    );
  });
});

describe('transfer_assignment', () => {
  async function teacherAssignmentId(userId: string): Promise<string> {
    const [row] = await database.query<{ id: string }>(
      `select id from public.staff_assignments where user_id = $1 and ends_on is null`,
      [userId],
    );
    return row?.id ?? '';
  }

  it('ends the current posting and starts the new one on the transfer date', async () => {
    const assignmentId = await teacherAssignmentId(scenario.staff.teacherA2);
    const [row] = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ id: string }>(
        `select public.transfer_assignment($1, 'teacher', private.today(), $2) as id`,
        [assignmentId, scenario.schoolB1Id],
      ),
    );
    const rows = await database.query<{ id: string; school_id: string; open: boolean }>(
      `select id, school_id, ends_on is null as open from public.staff_assignments
       where user_id = $1 order by starts_on, created_at`,
      [scenario.staff.teacherA2],
    );
    expect(rows).toEqual([
      { id: assignmentId, school_id: scenario.schoolA2Id, open: false },
      { id: row?.id, school_id: scenario.schoolB1Id, open: true },
    ]);
  });

  it('promotes a teacher to CRP of a cluster', async () => {
    const assignmentId = await teacherAssignmentId(scenario.staff.teacherA2);
    await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query(`select public.transfer_assignment($1, 'crp', private.today(), $2)`, [
        assignmentId,
        scenario.clusterCId,
      ]),
    );
    const visible = await database.as(asUser(scenario.staff.teacherA2), (query) =>
      query<{ id: string }>('select id from public.schools order by id'),
    );
    expect(visible).toEqual([{ id: scenario.schoolC1Id }]);
  });

  it('changes nothing when the new posting is invalid', async () => {
    const assignmentId = await teacherAssignmentId(scenario.staff.teacherA2);
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`select public.transfer_assignment($1, 'teacher', private.today(), $2)`, [
          assignmentId,
          scenario.clusterCId,
        ]),
      ),
    );
    expect(code).toBe('22023');
    const [row] = await database.query<{ open: boolean }>(
      'select ends_on is null as open from public.staff_assignments where id = $1',
      [assignmentId],
    );
    expect(row?.open).toBe(true);
  });

  it('refuses ended assignments, early dates and anyone but a super administrator', async () => {
    const assignmentId = await teacherAssignmentId(scenario.staff.teacherA2);
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.superAdmin), (query) =>
          query(`select public.transfer_assignment($1, 'teacher', private.today() - 400, $2)`, [
            assignmentId,
            scenario.schoolB1Id,
          ]),
        ),
      ),
    ).toBe('22023');
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.crpA), (query) =>
          query(`select public.transfer_assignment($1, 'teacher', private.today(), $2)`, [
            assignmentId,
            scenario.schoolB1Id,
          ]),
        ),
      ),
    ).toBe('42501');
  });
});

describe('my_schools_overview', () => {
  interface OverviewRow {
    school_id: string;
    active_students: number;
    pending_students: number;
    teachers: number;
    current_classes: number;
  }

  const overviewFor = (userId: string) =>
    database.as(asUser(userId), (query) =>
      query<OverviewRow>(
        `select school_id, active_students::int, pending_students::int, teachers::int,
                current_classes::int
         from public.my_schools_overview()`,
      ),
    );

  it('gives a CRP the figures of every school in the cluster', async () => {
    const rows = await overviewFor(scenario.staff.crpA);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          school_id: scenario.schoolA1Id,
          active_students: 3,
          pending_students: 1,
          teachers: 2,
          current_classes: 2,
        },
        {
          school_id: scenario.schoolA2Id,
          active_students: 0,
          pending_students: 0,
          teachers: 1,
          current_classes: 0,
        },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('gives a teacher only their school and an officer nothing', async () => {
    const teacherRows = await overviewFor(scenario.staff.teacherB1);
    expect(teacherRows.map((row) => row.school_id)).toEqual([scenario.schoolB1Id]);
    expect(await overviewFor(scenario.staff.blockOfficer)).toEqual([]);
  });
});

describe('accounts that are switched off', () => {
  const switchOff = (userId: string) =>
    database.query('update public.profiles set is_active = false where id = $1', [userId]);

  it('are not counted as family accounts on the overview', async () => {
    await switchOff(scenario.familyAccountId);
    const [row] = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ overview: Record<string, unknown> }>('select public.admin_overview() as overview'),
    );
    expect(row?.overview).toMatchObject({ family_accounts: 0 });
  });

  it('are not counted as teachers on the CRP home page', async () => {
    await switchOff(scenario.staff.teacherA1Colleague);
    const rows = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ school_id: string; teachers: number }>(
        'select school_id, teachers::int from public.my_schools_overview()',
      ),
    );
    expect(rows.find((row) => row.school_id === scenario.schoolA1Id)?.teachers).toBe(1);
  });
});

describe('family sign-in state', () => {
  const learner = () => scenario.students.a1Active[0];

  /** The state as the console reads it: a computed column of the learner rows the caller can see. */
  const stateSeenBy = (userId: string) =>
    database.as(asUser(userId), (query) =>
      query<{ id: string; active: boolean }>(
        'select s.id, public.family_sign_in_active(s) as active from public.students as s where s.id = $1',
        [learner()],
      ),
    );

  /** The state asked for with a record made up by the caller instead of one it can read. */
  const stateForMadeUpRecord = (userId: string) =>
    database.as(asUser(userId), (query) =>
      query<{ active: boolean }>(
        `select public.family_sign_in_active(
           jsonb_populate_record(null::public.students, jsonb_build_object('id', $1::uuid))
         ) as active`,
        [learner()],
      ),
    );

  it('is on for an issued sign-in, for everyone who can see the learner', async () => {
    for (const userId of [
      scenario.staff.superAdmin,
      scenario.staff.crpA,
      scenario.staff.teacherA1,
      scenario.familyAccountId,
    ]) {
      expect(await stateSeenBy(userId)).toEqual([{ id: learner(), active: true }]);
    }
  });

  it('is off once the sign-in has been withdrawn', async () => {
    await database.query('update public.profiles set is_active = false where id = $1', [
      scenario.familyAccountId,
    ]);
    expect(await stateSeenBy(scenario.staff.crpA)).toEqual([{ id: learner(), active: false }]);
  });

  it('is off for learners without a family account', async () => {
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ active: boolean }>(
        'select public.family_sign_in_active(s) as active from public.students as s where s.id = $1',
        [scenario.students.a1Active[1]],
      ),
    );
    expect(rows).toEqual([{ active: false }]);
  });

  it('reveals nothing about learners outside the schools of the caller', async () => {
    expect(await stateForMadeUpRecord(scenario.staff.teacherB1)).toEqual([{ active: false }]);
    expect(await stateForMadeUpRecord(scenario.staff.crpB)).toEqual([{ active: false }]);
    expect(await stateForMadeUpRecord(scenario.staff.teacherA1)).toEqual([{ active: true }]);
  });

  it('cannot be read without signing in', async () => {
    const code = await errorCodeOf(
      database.as({ kind: 'anon' }, (query) =>
        query(
          `select public.family_sign_in_active(
             jsonb_populate_record(null::public.students, jsonb_build_object('id', $1::uuid)))`,
          [learner()],
        ),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('transfers to inactive schools', () => {
  it('are refused for teachers', async () => {
    const [assignment] = await database.query<{ id: string }>(
      'select id from public.staff_assignments where user_id = $1 and ends_on is null',
      [scenario.staff.teacherA2],
    );
    await database.query('update public.schools set is_active = false where id = $1', [
      scenario.schoolB1Id,
    ]);
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`select public.transfer_assignment($1, 'teacher', private.today(), $2)`, [
          assignment?.id,
          scenario.schoolB1Id,
        ]),
      ),
    );
    expect(code).toBe('22023');
  });
});
