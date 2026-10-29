import { randomUUID } from 'node:crypto';
import type { QueryFunction, TestDatabase } from './database';

/**
 * A small education district used by the tests:
 *
 *   district
 *   ├── north block ── cluster A ── schools A1, A2
 *   │                └ cluster B ── school B1
 *   └── south block ── cluster C ── school C1
 *
 * Staff are created through the real provisioning trigger, so every test also exercises it.
 */
export interface Scenario {
  stateId: string;
  districtId: string;
  northBlockId: string;
  southBlockId: string;
  clusterAId: string;
  clusterBId: string;
  clusterCId: string;
  schoolA1Id: string;
  schoolA2Id: string;
  schoolB1Id: string;
  schoolC1Id: string;
  academicYearId: string;
  classA1Grade1Id: string;
  classA1Grade2Id: string;
  classB1Grade1Id: string;
  staff: {
    superAdmin: string;
    districtOfficer: string;
    blockOfficer: string;
    crpA: string;
    crpB: string;
    teacherA1: string;
    teacherA1Colleague: string;
    teacherA2: string;
    teacherB1: string;
  };
  students: {
    a1Active: [string, string, string];
    a1Pending: string;
    b1Active: string;
  };
  familyAccountId: string;
}

type StaffRole = 'super_admin' | 'district_officer' | 'block_officer' | 'crp' | 'teacher';

let emailCounter = 0;

function nextEmail(): string {
  emailCounter += 1;
  return `account-${emailCounter}@test.invalid`;
}

/**
 * Creates a sign-in identity the way the Auth admin API does: the row is inserted with provider
 * details only, then the requested `app_metadata` is merged in by a separate update within the same
 * transaction.
 */
export async function createAuthIdentity(
  query: QueryFunction,
  appMetadata: Record<string, unknown>,
  userMetadata: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await query(
    `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, '{"provider": "email", "providers": ["email"]}', $3)`,
    [id, nextEmail(), JSON.stringify(userMetadata)],
  );
  if (Object.keys(appMetadata).length > 0) {
    await query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1`,
      [id, JSON.stringify(appMetadata)],
    );
  }
  return id;
}

/**
 * Staff account as it is after its owner has chosen a password, unless `passwordChangeRequired` is
 * set to model an account that is still on its administrator-issued password.
 */
export async function provisionStaff(
  query: QueryFunction,
  details: {
    fullName: string;
    role: StaffRole;
    scopeId?: string;
    provisionedBy?: string;
    passwordChangeRequired?: boolean;
  },
): Promise<string> {
  return createAuthIdentity(query, {
    provisioning: {
      account_kind: 'staff',
      full_name: details.fullName,
      preferred_language: 'hi',
      provisioned_by: details.provisionedBy,
      password_change_required: details.passwordChangeRequired ?? false,
      assignment: { role: details.role, scope_id: details.scopeId },
    },
  });
}

export async function provisionFamily(query: QueryFunction, studentId: string): Promise<string> {
  return createAuthIdentity(query, {
    provisioning: { account_kind: 'student', student_id: studentId },
  });
}

async function insertReturningId(
  query: QueryFunction,
  sql: string,
  params: unknown[],
): Promise<string> {
  const [row] = await query<{ id: string }>(sql, params);
  if (!row) {
    throw new Error(`Insert returned no row: ${sql}`);
  }
  return row.id;
}

/** Academic session (April to March) that contains today's date in India. */
function currentAcademicYear(): { label: string; startsOn: string; endsOn: string } {
  const indiaNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const year = indiaNow.getUTCFullYear();
  const startYear = indiaNow.getUTCMonth() >= 3 ? year : year - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    startsOn: `${startYear}-04-01`,
    endsOn: `${startYear + 1}-03-31`,
  };
}

export async function insertStudent(
  query: QueryFunction,
  details: {
    schoolId: string;
    fullName: string;
    status?: 'pending' | 'active';
    classSectionId?: string;
  },
): Promise<string> {
  const studentId = await insertReturningId(
    query,
    `insert into public.students (school_id, full_name, gender, status)
     values ($1, $2, 'female', $3) returning id`,
    [details.schoolId, details.fullName, details.status ?? 'active'],
  );
  if (details.classSectionId) {
    await query(
      `insert into public.enrolments (student_id, class_section_id, enrolled_on)
       values ($1, $2, private.today() - 60)`,
      [studentId, details.classSectionId],
    );
  }
  return studentId;
}

export async function createScenario(database: TestDatabase): Promise<Scenario> {
  const { query } = database;

  const stateId = await insertReturningId(
    query,
    `insert into public.states (code, name_en) values ('09', 'State') returning id`,
    [],
  );
  const districtId = await insertReturningId(
    query,
    `insert into public.districts (state_id, code, name_en) values ($1, '0901', 'District') returning id`,
    [stateId],
  );
  const northBlockId = await insertReturningId(
    query,
    `insert into public.blocks (district_id, code, name_en) values ($1, '090101', 'North') returning id`,
    [districtId],
  );
  const southBlockId = await insertReturningId(
    query,
    `insert into public.blocks (district_id, code, name_en) values ($1, '090102', 'South') returning id`,
    [districtId],
  );

  const cluster = (blockId: string, code: string) =>
    insertReturningId(
      query,
      `insert into public.clusters (block_id, code, name_en) values ($1, $2, $3) returning id`,
      [blockId, code, `Cluster ${code}`],
    );
  const clusterAId = await cluster(northBlockId, '0901010001');
  const clusterBId = await cluster(northBlockId, '0901010002');
  const clusterCId = await cluster(southBlockId, '0901020001');

  const school = (clusterId: string, udiseCode: string, name: string) =>
    insertReturningId(
      query,
      `insert into public.schools (cluster_id, udise_code, name_en) values ($1, $2, $3) returning id`,
      [clusterId, udiseCode, name],
    );
  const schoolA1Id = await school(clusterAId, '09010100101', 'School A1');
  const schoolA2Id = await school(clusterAId, '09010100102', 'School A2');
  const schoolB1Id = await school(clusterBId, '09010100201', 'School B1');
  const schoolC1Id = await school(clusterCId, '09010200101', 'School C1');

  const year = currentAcademicYear();
  const academicYearId = await insertReturningId(
    query,
    `insert into public.academic_years (label, starts_on, ends_on) values ($1, $2, $3) returning id`,
    [year.label, year.startsOn, year.endsOn],
  );

  const classSection = (schoolId: string, grade: number) =>
    insertReturningId(
      query,
      `insert into public.class_sections (school_id, academic_year_id, grade)
       values ($1, $2, $3) returning id`,
      [schoolId, academicYearId, grade],
    );
  const classA1Grade1Id = await classSection(schoolA1Id, 1);
  const classA1Grade2Id = await classSection(schoolA1Id, 2);
  const classB1Grade1Id = await classSection(schoolB1Id, 1);

  const superAdmin = await provisionStaff(query, {
    fullName: 'Administrator',
    role: 'super_admin',
  });
  const staff = {
    superAdmin,
    districtOfficer: await provisionStaff(query, {
      fullName: 'District Officer',
      role: 'district_officer',
      scopeId: districtId,
      provisionedBy: superAdmin,
    }),
    blockOfficer: await provisionStaff(query, {
      fullName: 'Block Officer',
      role: 'block_officer',
      scopeId: northBlockId,
      provisionedBy: superAdmin,
    }),
    crpA: await provisionStaff(query, { fullName: 'CRP A', role: 'crp', scopeId: clusterAId }),
    crpB: await provisionStaff(query, { fullName: 'CRP B', role: 'crp', scopeId: clusterBId }),
    teacherA1: await provisionStaff(query, {
      fullName: 'Teacher A1',
      role: 'teacher',
      scopeId: schoolA1Id,
    }),
    teacherA1Colleague: await provisionStaff(query, {
      fullName: 'Teacher A1 Colleague',
      role: 'teacher',
      scopeId: schoolA1Id,
    }),
    teacherA2: await provisionStaff(query, {
      fullName: 'Teacher A2',
      role: 'teacher',
      scopeId: schoolA2Id,
    }),
    teacherB1: await provisionStaff(query, {
      fullName: 'Teacher B1',
      role: 'teacher',
      scopeId: schoolB1Id,
    }),
  };

  await query(
    `insert into public.class_teachers (class_section_id, teacher_id, is_primary) values ($1, $2, true)`,
    [classA1Grade1Id, staff.teacherA1],
  );

  const a1Active: [string, string, string] = [
    await insertStudent(query, {
      schoolId: schoolA1Id,
      fullName: 'Learner One',
      classSectionId: classA1Grade1Id,
    }),
    await insertStudent(query, {
      schoolId: schoolA1Id,
      fullName: 'Learner Two',
      classSectionId: classA1Grade1Id,
    }),
    await insertStudent(query, {
      schoolId: schoolA1Id,
      fullName: 'Learner Three',
      classSectionId: classA1Grade1Id,
    }),
  ];
  const a1Pending = await insertStudent(query, {
    schoolId: schoolA1Id,
    fullName: 'Learner Pending',
    status: 'pending',
    classSectionId: classA1Grade1Id,
  });
  const b1Active = await insertStudent(query, {
    schoolId: schoolB1Id,
    fullName: 'Learner B',
    classSectionId: classB1Grade1Id,
  });

  await query(
    `insert into public.student_contacts (student_id, guardian_name, relationship, guardian_phone)
     values ($1, 'Guardian One', 'mother', '9876543210')`,
    [a1Active[0]],
  );

  const familyAccountId = await provisionFamily(query, a1Active[0]);

  return {
    stateId,
    districtId,
    northBlockId,
    southBlockId,
    clusterAId,
    clusterBId,
    clusterCId,
    schoolA1Id,
    schoolA2Id,
    schoolB1Id,
    schoolC1Id,
    academicYearId,
    classA1Grade1Id,
    classA1Grade2Id,
    classB1Grade1Id,
    staff,
    students: { a1Active, a1Pending, b1Active },
    familyAccountId,
  };
}

export function asUser(id: string): { kind: 'user'; id: string } {
  return { kind: 'user', id };
}
