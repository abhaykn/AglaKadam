import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, owner, type TestDatabase } from './support/database';
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

interface StudentRow {
  id: string;
  student_code: string;
  status: string;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  auth_user_id: string | null;
}

function luhnIsValid(code: string): boolean {
  let total = 0;
  for (let index = 0; index < code.length; index += 1) {
    let digit = Number(code[code.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    total += digit;
  }
  return total % 10 === 0;
}

async function addStudentAs(
  userId: string,
  schoolId: string,
  extra: Partial<{ status: string; student_code: string; auth_user_id: string }> = {},
): Promise<StudentRow> {
  const rows = await database.as(asUser(userId), (query) =>
    query<StudentRow>(
      `insert into public.students (school_id, full_name, gender, status, student_code, auth_user_id)
       values ($1, 'New Learner', 'male', coalesce($2, 'pending'), $3, $4)
       returning id, student_code, status, created_by, verified_by, verified_at, auth_user_id`,
      [schoolId, extra.status ?? null, extra.student_code ?? null, extra.auth_user_id ?? null],
    ),
  );
  const [row] = rows;
  if (!row) {
    throw new Error('The insert returned no row.');
  }
  return row;
}

describe('learner codes', () => {
  it('computes the Luhn check digit correctly', async () => {
    const [row] = await database.query<{ digit: number }>(
      `select private.luhn_check_digit('7992739871') as digit`,
    );
    expect(row?.digit).toBe(3);
  });

  it('assigns a valid code and ignores any code sent by the client', async () => {
    const student = await addStudentAs(scenario.staff.teacherA1, scenario.schoolA1Id, {
      student_code: '1234567890',
    });
    expect(student.student_code).toMatch(/^[1-9][0-9]{9}$/);
    expect(student.student_code).not.toBe('1234567890');
    expect(luhnIsValid(student.student_code)).toBe(true);
  });

  it('never lets a code change', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`update public.students set student_code = '1000000009' where id = $1`, [
          scenario.students.a1Active[1],
        ]),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('adding students', () => {
  it('keeps a student added by a teacher pending and records the teacher', async () => {
    const student = await addStudentAs(scenario.staff.teacherA1, scenario.schoolA1Id, {
      auth_user_id: scenario.staff.teacherA1,
    });
    expect(student).toMatchObject({
      status: 'pending',
      created_by: scenario.staff.teacherA1,
      verified_by: null,
      auth_user_id: null,
    });
  });

  it('does not let a teacher add an already verified student', async () => {
    const code = await errorCodeOf(
      addStudentAs(scenario.staff.teacherA1, scenario.schoolA1Id, { status: 'active' }),
    );
    expect(code).toBe('42501');
  });

  it('does not let a teacher add a student to another school', async () => {
    const code = await errorCodeOf(addStudentAs(scenario.staff.teacherA1, scenario.schoolB1Id));
    expect(code).toBe('42501');
  });

  it('lets the CRP add a verified student directly', async () => {
    const student = await addStudentAs(scenario.staff.crpA, scenario.schoolA2Id, {
      status: 'active',
    });
    expect(student.status).toBe('active');
    expect(student.verified_by).toBe(scenario.staff.crpA);
    expect(student.verified_at).not.toBeNull();
  });

  it('rejects a date of birth in the future', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(
          `insert into public.students (school_id, full_name, gender, date_of_birth)
           values ($1, 'Future', 'female', private.today() + 1)`,
          [scenario.schoolA1Id],
        ),
      ),
    );
    expect(code).toBe('23514');
  });
});

describe('verification and departures', () => {
  it('lets the CRP verify a pending student', async () => {
    const [row] = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<StudentRow>(
        `update public.students set status = 'active' where id = $1
         returning id, status, verified_by, verified_at`,
        [scenario.students.a1Pending],
      ),
    );
    expect(row).toMatchObject({ status: 'active', verified_by: scenario.staff.crpA });
    expect(row?.verified_at).not.toBeNull();
  });

  it('does not let a teacher verify a student', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(`update public.students set status = 'active' where id = $1`, [
          scenario.students.a1Pending,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('does not let a teacher remove a verified child from the class', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(
          `update public.students
           set status = 'left', left_on = private.today(), left_reason = 'migrated'
           where id = $1`,
          [scenario.students.a1Active[1]],
        ),
      ),
    );
    expect(code).toBe('42501');
  });

  it('does not let a teacher change the special needs flag of a verified child', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(`update public.students set has_special_needs = true where id = $1`, [
          scenario.students.a1Active[1],
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('lets a teacher correct details only while the student is pending', async () => {
    const pending = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(`update public.students set full_name = 'Corrected' where id = $1 returning id`, [
        scenario.students.a1Pending,
      ]),
    );
    expect(pending).toHaveLength(1);

    for (const change of [
      `full_name = 'Someone Else'`,
      `gender = 'male'`,
      `date_of_birth = date '2019-01-01'`,
      `admission_number = 'A-77'`,
    ]) {
      const code = await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(`update public.students set ${change} where id = $1`, [
            scenario.students.a1Active[1],
          ]),
        ),
      );
      expect(code, change).toBe('42501');
    }
  });

  it('lets the CRP correct the details of a verified child', async () => {
    const rows = await database.as(asUser(scenario.staff.crpA), (query) =>
      query(`update public.students set full_name = 'Corrected' where id = $1 returning id`, [
        scenario.students.a1Active[1],
      ]),
    );
    expect(rows).toHaveLength(1);
  });

  it('never lets a student record change its identifier', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`update public.students set id = gen_random_uuid() where id = $1`, [
          scenario.students.a1Active[1],
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('closes the open enrolment when the CRP records a departure', async () => {
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query(
        `update public.students
         set status = 'left', left_on = private.today(), left_reason = 'transferred'
         where id = $1`,
        [scenario.students.a1Active[2]],
      ),
    );
    const [enrolment] = await database.query<{ ended: boolean }>(
      `select ended_on = private.today() as ended from public.enrolments where student_id = $1`,
      [scenario.students.a1Active[2]],
    );
    expect(enrolment?.ended).toBe(true);
  });

  it('requires a date and reason for a departure', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(`update public.students set status = 'left' where id = $1`, [
          scenario.students.a1Active[2],
        ]),
      ),
    );
    expect(code).toBe('23514');
  });

  it('never returns a verified student to pending', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`update public.students set status = 'pending' where id = $1`, [
          scenario.students.a1Active[1],
        ]),
      ),
    );
    expect(code).toBe('23514');
  });

  it('lets only an administrator move a student to another school', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(`update public.students set school_id = $2 where id = $1`, [
          scenario.students.a1Active[1],
          scenario.schoolA2Id,
        ]),
      ),
    );
    expect(code).toBe('42501');

    await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query(`update public.students set school_id = $2 where id = $1`, [
        scenario.students.a1Active[1],
        scenario.schoolA2Id,
      ]),
    );
    const [enrolment] = await database.query<{ ended_on: string | null }>(
      `select ended_on::text from public.enrolments where student_id = $1`,
      [scenario.students.a1Active[1]],
    );
    expect(enrolment?.ended_on).not.toBeNull();
  });
});

describe('removing students', () => {
  it('lets a teacher remove a pending student they added', async () => {
    const student = await addStudentAs(scenario.staff.teacherA1, scenario.schoolA1Id);
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('delete from public.students where id = $1 returning id', [student.id]),
    );
    expect(rows).toHaveLength(1);
  });

  it('does not let a teacher remove a verified student', async () => {
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('delete from public.students where id = $1 returning id', [
        scenario.students.a1Active[1],
      ]),
    );
    expect(rows).toEqual([]);
  });
});

describe('student visibility', () => {
  it('lets teachers and the CRP see the school’s students, and nobody else', async () => {
    const forTeacher = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select id from public.students'),
    );
    expect(forTeacher).toHaveLength(4);

    const forCrpB = await database.as(asUser(scenario.staff.crpB), (query) =>
      query('select id from public.students'),
    );
    expect(forCrpB).toEqual([{ id: scenario.students.b1Active }]);

    const forOfficer = await database.as(asUser(scenario.staff.blockOfficer), (query) =>
      query('select id from public.students'),
    );
    expect(forOfficer).toEqual([]);
  });

  it('lets a family account see only its own child and class', async () => {
    const students = await database.as(asUser(scenario.familyAccountId), (query) =>
      query('select id from public.students'),
    );
    expect(students).toEqual([{ id: scenario.students.a1Active[0] }]);

    const classes = await database.as(asUser(scenario.familyAccountId), (query) =>
      query('select id from public.class_sections'),
    );
    expect(classes).toEqual([{ id: scenario.classA1Grade1Id }]);
  });
});

describe('guardian contacts', () => {
  it('are visible to the school’s teachers and the family but not to the CRP', async () => {
    const forTeacher = await database.as(asUser(scenario.staff.teacherA1Colleague), (query) =>
      query('select student_id from public.student_contacts'),
    );
    expect(forTeacher).toHaveLength(1);

    const forFamily = await database.as(asUser(scenario.familyAccountId), (query) =>
      query('select student_id from public.student_contacts'),
    );
    expect(forFamily).toHaveLength(1);

    const forCrp = await database.as(asUser(scenario.staff.crpA), (query) =>
      query('select student_id from public.student_contacts'),
    );
    expect(forCrp).toEqual([]);
  });

  it('reject an invalid mobile number', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(
          `insert into public.student_contacts (student_id, guardian_name, relationship, guardian_phone)
           values ($1, 'Parent', 'father', '12345')`,
          [scenario.students.a1Active[1]],
        ),
      ),
    );
    expect(code).toBe('23514');
  });
});

describe('enrolments', () => {
  it('rejects enrolling a student in a class of another school', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`insert into public.enrolments (student_id, class_section_id) values ($1, $2)`, [
          scenario.students.b1Active,
          scenario.classA1Grade2Id,
        ]),
      ),
    );
    expect(code).toBe('23514');
  });

  it('allows only one open enrolment per student', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(`insert into public.enrolments (student_id, class_section_id) values ($1, $2)`, [
          scenario.students.a1Active[1],
          scenario.classA1Grade2Id,
        ]),
      ),
    );
    expect(code).toBe('23505');
  });

  it('lets a teacher change the roll number but not the dates', async () => {
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(`update public.enrolments set roll_number = 7 where student_id = $1 returning id`, [
        scenario.students.a1Active[1],
      ]),
    );
    expect(rows).toHaveLength(1);

    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(`update public.enrolments set ended_on = private.today() where student_id = $1`, [
          scenario.students.a1Active[1],
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('lets the CRP move a student to another class of the same school', async () => {
    await database.as(asUser(scenario.staff.crpA), async (query) => {
      await query(`update public.enrolments set ended_on = private.today() where student_id = $1`, [
        scenario.students.a1Active[1],
      ]);
      await query(`insert into public.enrolments (student_id, class_section_id) values ($1, $2)`, [
        scenario.students.a1Active[1],
        scenario.classA1Grade2Id,
      ]);
    });
    const open = await database.query(
      `select class_section_id from public.enrolments where student_id = $1 and ended_on is null`,
      [scenario.students.a1Active[1]],
    );
    expect(open).toEqual([{ class_section_id: scenario.classA1Grade2Id }]);
  });

  it('does not enrol a student who has left', async () => {
    await database.query(
      `update public.students set status = 'left', left_on = private.today(), left_reason = 'other'
       where id = $1`,
      [scenario.students.a1Active[2]],
    );
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(`insert into public.enrolments (student_id, class_section_id) values ($1, $2)`, [
          scenario.students.a1Active[2],
          scenario.classA1Grade2Id,
        ]),
      ),
    );
    expect(code).toBe('23514');
  });
});

describe('guardian consent', () => {
  it('stamps who recorded it and when', async () => {
    const [row] = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ recorded_by: string }>(
        `insert into public.guardian_consents
           (student_id, purpose, granted, guardian_name, method, recorded_by)
         values ($1, 'audio_assessment', true, 'Parent', 'paper_form', $2)
         returning recorded_by`,
        [scenario.students.a1Active[1], scenario.staff.crpA],
      ),
    );
    expect(row?.recorded_by).toBe(scenario.staff.teacherA1);
  });

  it('follows the most recent decision', async () => {
    const consentOf = async (): Promise<boolean | undefined> => {
      const [row] = await database.query<{ granted: boolean }>(
        `select private.has_guardian_consent($1, 'audio_assessment') as granted`,
        [scenario.students.a1Active[1]],
      );
      return row?.granted;
    };

    expect(await consentOf()).toBe(false);

    const record = (granted: boolean) =>
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(
          `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method)
           values ($1, 'audio_assessment', $2, 'Parent', 'in_person')`,
          [scenario.students.a1Active[1], granted],
        ),
      );

    await record(true);
    expect(await consentOf()).toBe(true);
    await record(false);
    expect(await consentOf()).toBe(false);
  });

  it('dates a decision kept on a phone when it was taken, so the latest one is in force', async () => {
    const child = scenario.students.a1Active[2];
    const record = (granted: boolean, at: string) =>
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query<{ recorded_at: Date }>(
          `insert into public.guardian_consents
             (student_id, purpose, granted, guardian_name, method, recorded_at)
           values ($1, 'audio_assessment', $2, 'Parent', 'paper_form', $3)
           returning recorded_at`,
          [child, granted, at],
        ),
      );
    // The family withdrew on one phone yesterday; a grant made two days ago on another phone
    // reaches the server afterwards and does not override it.
    const day = 24 * 60 * 60 * 1000;
    await record(false, new Date(Date.now() - day).toISOString());
    const [late] = await record(true, new Date(Date.now() - 2 * day).toISOString());
    expect(Date.now() - new Date(late?.recorded_at ?? 0).getTime()).toBeGreaterThan(1.9 * day);
    const [row] = await database.query<{ granted: boolean }>(
      `select private.has_guardian_consent($1, 'audio_assessment') as granted`,
      [child],
    );
    expect(row?.granted).toBe(false);
    // Never in the future, nor more than 30 days back.
    const [future] = await record(false, new Date(Date.now() + day).toISOString());
    expect(new Date(future?.recorded_at ?? 0).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const [old] = await record(false, new Date(Date.now() - 90 * day).toISOString());
    expect(Date.now() - new Date(old?.recorded_at ?? 0).getTime()).toBeLessThan(30.1 * day);
  });

  it('records a decision sent twice from a device only once', async () => {
    const id = '7d3c9f4e-2b1a-4c8d-9e6f-0a1b2c3d4e5f';
    const send = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query(
          `insert into public.guardian_consents (id, student_id, purpose, granted, guardian_name, method)
           values ($1, $2, 'audio_assessment', true, 'Parent', 'paper_form')
           on conflict (id) do nothing
           returning id`,
          [id, scenario.students.a1Active[1]],
        ),
      );
    expect(await send(scenario.staff.teacherA1)).toHaveLength(1);
    expect(await send(scenario.staff.teacherA1)).toHaveLength(0);
    const [count] = await database.query<{ count: number }>(
      'select count(*)::int as count from public.guardian_consents where id = $1',
      [id],
    );
    expect(count?.count).toBe(1);
    expect(await errorCodeOf(send(scenario.staff.teacherB1))).toBe('42501');
  });

  it('cannot be edited or deleted through the API', async () => {
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method)
         values ($1, 'audio_assessment', true, 'Parent', 'in_person')`,
        [scenario.students.a1Active[1]],
      ),
    );
    const updateCode = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`update public.guardian_consents set granted = false`),
      ),
    );
    const deleteCode = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`delete from public.guardian_consents`),
      ),
    );
    expect(updateCode).toBe('42501');
    expect(deleteCode).toBe('42501');
  });
});

describe('classes and class teachers', () => {
  it('lets the CRP open a class but not a teacher', async () => {
    const insert = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query(
          `insert into public.class_sections (school_id, academic_year_id, grade, section)
           values ($1, $2, 3, 'B') returning id`,
          [scenario.schoolA1Id, scenario.academicYearId],
        ),
      );
    expect(await errorCodeOf(insert(scenario.staff.teacherA1))).toBe('42501');
    expect(await insert(scenario.staff.crpA)).toHaveLength(1);
  });

  it('allows the CRP to change only the medium and status of a class', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(`update public.class_sections set grade = 3 where id = $1`, [
          scenario.classA1Grade2Id,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('assigns only teachers of the same school', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(`insert into public.class_teachers (class_section_id, teacher_id) values ($1, $2)`, [
          scenario.classA1Grade2Id,
          scenario.staff.teacherA2,
        ]),
      ),
    );
    expect(code).toBe('23514');

    const rows = await database.as(asUser(scenario.staff.crpA), (query) =>
      query(
        `insert into public.class_teachers (class_section_id, teacher_id) values ($1, $2) returning teacher_id`,
        [scenario.classA1Grade2Id, scenario.staff.teacherA1Colleague],
      ),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('academic years', () => {
  it('cannot overlap', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        query(
          `insert into public.academic_years (label, starts_on, ends_on)
           select '1999-00', starts_on + 10, ends_on + 10 from public.academic_years`,
        ),
      ),
    );
    expect(code).toBe('23P01');
  });
});

describe('enrolment dates set by teachers', () => {
  async function enrolAs(userId: string, enrolledOnOffset: number, ended: boolean) {
    const [student] = await database.as(asUser(userId), (query) =>
      query<{ id: string }>(
        `insert into public.students (school_id, full_name, gender) values ($1, 'New', 'male')
         returning id`,
        [scenario.schoolA1Id],
      ),
    );
    return database.as(asUser(userId), (query) =>
      query(
        `insert into public.enrolments (student_id, class_section_id, enrolled_on, ended_on)
         values ($1, $2, private.today() + $3::int,
                 case when $4 then private.today() + $3::int end)
         returning id`,
        [student?.id, scenario.classA1Grade2Id, enrolledOnOffset, ended],
      ),
    );
  }

  it('accepts an admission from today or the last 31 days', async () => {
    expect(await enrolAs(scenario.staff.teacherA1, 0, false)).toHaveLength(1);
    expect(await enrolAs(scenario.staff.teacherA1, -31, false)).toHaveLength(1);
  });

  it('refuses future, back-dated or already closed enrolments from a teacher', async () => {
    expect(await errorCodeOf(enrolAs(scenario.staff.teacherA1, 30, false))).toBe('42501');
    expect(await errorCodeOf(enrolAs(scenario.staff.teacherA1, -32, false))).toBe('42501');
    expect(await errorCodeOf(enrolAs(scenario.staff.teacherA1, -3, true))).toBe('42501');
  });

  it('lets the CRP record an earlier admission', async () => {
    expect(await enrolAs(scenario.staff.crpA, -90, false)).toHaveLength(1);
  });
});

describe('consent records and deletion', () => {
  it('keep a pending student with recorded consent from being deleted', async () => {
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method)
         values ($1, 'audio_assessment', false, 'Parent', 'in_person')`,
        [scenario.students.a1Pending],
      ),
    );
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query('delete from public.students where id = $1', [scenario.students.a1Pending]),
      ),
    );
    expect(code).toBe('23001');
  });

  it('are not visible to the CRP', async () => {
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method)
         values ($1, 'audio_assessment', true, 'Parent', 'in_person')`,
        [scenario.students.a1Active[1]],
      ),
    );
    const forCrp = await database.as(asUser(scenario.staff.crpA), (query) =>
      query('select id from public.guardian_consents'),
    );
    expect(forCrp).toEqual([]);

    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(
          `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method)
           values ($1, 'audio_assessment', true, 'Parent', 'in_person')`,
          [scenario.students.a1Active[1]],
        ),
      ),
    );
    expect(code).toBe('42501');
  });
});
