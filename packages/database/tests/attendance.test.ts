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

interface AttendanceRow {
  id: string;
  enrolled_count: number;
  present_count: number;
  absent_student_ids: string[];
  marked_by: string;
}

function markAttendance(
  userId: string,
  details: { classSectionId?: string; daysAgo?: number; absent?: string[]; enrolledCount?: number },
): Promise<AttendanceRow[]> {
  return database.as(asUser(userId), (query) =>
    query<AttendanceRow>(
      `insert into public.attendance_sessions
         (class_section_id, attendance_date, absent_student_ids, enrolled_count, marked_by)
       values ($1, private.today() - $2::int, $3::uuid[], $4, $5)
       returning id, enrolled_count, present_count, absent_student_ids, marked_by`,
      [
        details.classSectionId ?? scenario.classA1Grade1Id,
        details.daysAgo ?? 0,
        details.absent ?? [],
        details.enrolledCount ?? 0,
        scenario.staff.superAdmin,
      ],
    ),
  );
}

describe('marking attendance', () => {
  it('computes the class roll on the server and stamps the teacher', async () => {
    const [row] = await markAttendance(scenario.staff.teacherA1, {
      absent: [scenario.students.a1Active[0], scenario.students.a1Active[0]],
      enrolledCount: 99,
    });
    // Three verified students and one pending student are enrolled in the class.
    expect(row).toMatchObject({
      enrolled_count: 4,
      present_count: 3,
      absent_student_ids: [scenario.students.a1Active[0]],
      marked_by: scenario.staff.teacherA1,
    });
  });

  it('lets a colleague mark a class of the same school', async () => {
    const rows = await markAttendance(scenario.staff.teacherA1Colleague, {});
    expect(rows).toHaveLength(1);
  });

  it('ignores entries that are not on the class roll for that date', async () => {
    const [row] = await markAttendance(scenario.staff.teacherA1, {
      absent: [scenario.students.b1Active, scenario.students.a1Active[1]],
    });
    expect(row).toMatchObject({
      enrolled_count: 4,
      present_count: 3,
      absent_student_ids: [scenario.students.a1Active[1]],
    });
  });

  it('allows one record per class per day', async () => {
    await markAttendance(scenario.staff.teacherA1, {});
    const code = await errorCodeOf(markAttendance(scenario.staff.teacherA1Colleague, {}));
    expect(code).toBe('23505');
  });

  it('does not count a student before their enrolment date', async () => {
    const [row] = await markAttendance(scenario.staff.teacherA1, { daysAgo: 0 });
    expect(row?.enrolled_count).toBe(4);
    await database.query(
      `update public.enrolments set enrolled_on = private.today() where student_id = $1`,
      [scenario.students.a1Active[1]],
    );
    const [earlier] = await markAttendance(scenario.staff.teacherA1, { daysAgo: 1 });
    expect(earlier?.enrolled_count).toBe(3);
  });
});

describe('saving from a device', () => {
  /** The statement the Data API runs for an upsert on the class and date. */
  function upsertFromDevice(userId: string, daysAgo: number, absent: string[]) {
    return database.as(asUser(userId), (query) =>
      query<AttendanceRow>(
        `insert into public.attendance_sessions
           (class_section_id, attendance_date, absent_student_ids)
         values ($1, private.today() - $2::int, $3::uuid[])
         on conflict (class_section_id, attendance_date) do update set
           class_section_id = excluded.class_section_id,
           attendance_date = excluded.attendance_date,
           absent_student_ids = excluded.absent_student_ids
         returning id, enrolled_count, present_count, absent_student_ids, marked_by`,
        [scenario.classA1Grade1Id, daysAgo, absent],
      ),
    );
  }

  it('creates the record the first time and updates it when sent again', async () => {
    const [first] = await upsertFromDevice(scenario.staff.teacherA1, 0, [
      scenario.students.a1Active[0],
    ]);
    const [second] = await upsertFromDevice(scenario.staff.teacherA1Colleague, 0, [
      scenario.students.a1Active[1],
    ]);
    expect(second?.id).toBe(first?.id);
    expect(second).toMatchObject({
      absent_student_ids: [scenario.students.a1Active[1]],
      present_count: 3,
      marked_by: scenario.staff.teacherA1Colleague,
    });
  });

  it('leaves the same record when the same change arrives twice', async () => {
    const absent = [scenario.students.a1Active[2]];
    await upsertFromDevice(scenario.staff.teacherA1, 1, absent);
    await upsertFromDevice(scenario.staff.teacherA1, 1, absent);
    const rows = await database.query<{ total: number }>(
      `select count(*)::int as total from public.attendance_sessions
       where class_section_id = $1 and attendance_date = private.today() - 1`,
      [scenario.classA1Grade1Id],
    );
    expect(rows[0]?.total).toBe(1);
  });

  it('changes a day only if it is still the version the device started from', async () => {
    const [added] = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ updated_at: string; client_change_id: string }>(
        `insert into public.attendance_sessions
           (class_section_id, attendance_date, absent_student_ids, client_change_id)
         values ($1, private.today(), '{}', $2)
         returning updated_at::text, client_change_id`,
        [scenario.classA1Grade1Id, '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'],
      ),
    );
    expect(added?.client_change_id).toBe('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');

    const correct = (basedOn: string) =>
      database.as(asUser(scenario.staff.teacherA1Colleague), (query) =>
        query<{ client_change_id: string }>(
          `update public.attendance_sessions
           set absent_student_ids = array[$3::uuid], client_change_id = $4
           where class_section_id = $1 and attendance_date = private.today()
             and updated_at = $2::timestamptz
           returning client_change_id`,
          [
            scenario.classA1Grade1Id,
            basedOn,
            scenario.students.a1Active[0],
            '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b',
          ],
        ),
      );
    // Requests in production each run in their own transaction, so every save gets a new
    // `updated_at`. This test runs in one transaction, where now() does not move: the record is
    // dated a moment earlier instead (with triggers off for that one statement).
    await database.query(`set local session_replication_role = replica`);
    const [earlier] = await database.query<{ updated_at: string }>(
      `update public.attendance_sessions set updated_at = updated_at - interval '1 second'
       where class_section_id = $1 and attendance_date = private.today()
       returning updated_at::text`,
      [scenario.classA1Grade1Id],
    );
    await database.query(`set local session_replication_role = origin`);

    expect(await correct(earlier?.updated_at ?? '')).toHaveLength(1);
    // The same correction based on the version that has just been replaced changes nothing.
    expect(await correct(earlier?.updated_at ?? '')).toHaveLength(0);
  });

  it('accepts a first record saved offline up to 31 days ago', async () => {
    const rows = await upsertFromDevice(scenario.staff.teacherA1, 20, []);
    expect(rows).toHaveLength(1);
  });

  it('refuses a correction older than 7 days from a teacher', async () => {
    await upsertFromDevice(scenario.staff.superAdmin, 10, []);
    expect(
      await errorCodeOf(
        upsertFromDevice(scenario.staff.teacherA1, 10, [scenario.students.a1Active[0]]),
      ),
    ).toBe('42501');
  });
});

describe('who may mark attendance', () => {
  it('does not let a teacher of another school mark the class', async () => {
    const code = await errorCodeOf(markAttendance(scenario.staff.teacherB1, {}));
    expect(code).toBe('42501');
  });

  it('keeps the CRP read-only', async () => {
    await markAttendance(scenario.staff.teacherA1, {});
    const code = await errorCodeOf(markAttendance(scenario.staff.crpA, { daysAgo: 1 }));
    expect(code).toBe('42501');

    const visible = await database.as(asUser(scenario.staff.crpA), (query) =>
      query('select id from public.attendance_sessions'),
    );
    expect(visible).toHaveLength(1);
  });

  it('hides attendance from education officers and families', async () => {
    await markAttendance(scenario.staff.teacherA1, {});
    for (const userId of [scenario.staff.blockOfficer, scenario.familyAccountId]) {
      const visible = await database.as(asUser(userId), (query) =>
        query('select id from public.attendance_sessions'),
      );
      expect(visible).toEqual([]);
    }
  });
});

describe('time windows', () => {
  it('rejects a future date', async () => {
    const code = await errorCodeOf(markAttendance(scenario.staff.teacherA1, { daysAgo: -1 }));
    expect(code).toBe('23514');
  });

  it('accepts records synced up to 31 days late', async () => {
    const rows = await markAttendance(scenario.staff.teacherA1, { daysAgo: 31 });
    expect(rows).toHaveLength(1);
    const code = await errorCodeOf(markAttendance(scenario.staff.teacherA1, { daysAgo: 32 }));
    expect(code).toBe('42501');
  });

  it('allows corrections for 7 days only', async () => {
    const [recent] = await markAttendance(scenario.staff.teacherA1, { daysAgo: 7 });
    const [older] = await markAttendance(scenario.staff.teacherA1, { daysAgo: 8 });

    const correct = (id: string | undefined) =>
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(
          `update public.attendance_sessions set absent_student_ids = $2::uuid[] where id = $1
           returning id`,
          [id, [scenario.students.a1Active[1]]],
        ),
      );

    expect(await correct(recent?.id)).toHaveLength(1);
    expect(await errorCodeOf(correct(older?.id))).toBe('42501');
  });

  it('lets an administrator correct older records', async () => {
    const [older] = await markAttendance(scenario.staff.teacherA1, { daysAgo: 20 });
    const rows = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query(
        `update public.attendance_sessions set absent_student_ids = '{}' where id = $1 returning id`,
        [older?.id],
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it('never moves a record to another class or date', async () => {
    const [row] = await markAttendance(scenario.staff.teacherA1, { daysAgo: 1 });
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(
          `update public.attendance_sessions set attendance_date = private.today() where id = $1`,
          [row?.id],
        ),
      ),
    );
    expect(code).toBe('42501');
  });

  it('cannot be deleted through the API', async () => {
    await markAttendance(scenario.staff.teacherA1, {});
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query('delete from public.attendance_sessions'),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('inactive classes', () => {
  it('cannot receive new attendance', async () => {
    await database.query('update public.class_sections set is_active = false where id = $1', [
      scenario.classA1Grade1Id,
    ]);
    const code = await errorCodeOf(markAttendance(scenario.staff.teacherA1, {}));
    expect(code).toBe('23514');
  });
});

describe('history and late admissions', () => {
  it('keeps past counts unchanged when a record is corrected after a departure', async () => {
    const [record] = await markAttendance(scenario.staff.teacherA1, {
      daysAgo: 3,
      absent: [scenario.students.a1Active[2]],
    });
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query(
        `update public.students
         set status = 'left', left_on = private.today(), left_reason = 'migrated'
         where id = $1`,
        [scenario.students.a1Active[2]],
      ),
    );
    const [corrected] = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<AttendanceRow>(
        `update public.attendance_sessions set absent_student_ids = absent_student_ids
         where id = $1 returning enrolled_count, absent_student_ids`,
        [record?.id],
      ),
    );
    expect(corrected).toMatchObject({
      enrolled_count: 4,
      absent_student_ids: [scenario.students.a1Active[2]],
    });
  });

  it('counts a child admitted later in the day when the teacher saves again', async () => {
    const [first] = await markAttendance(scenario.staff.teacherA1, {});
    expect(first?.enrolled_count).toBe(4);

    await database.as(asUser(scenario.staff.teacherA1), async (query) => {
      const [student] = await query<{ id: string }>(
        `insert into public.students (school_id, full_name, gender) values ($1, 'Late', 'female')
         returning id`,
        [scenario.schoolA1Id],
      );
      await query(`insert into public.enrolments (student_id, class_section_id) values ($1, $2)`, [
        student?.id,
        scenario.classA1Grade1Id,
      ]);
    });

    const [saved] = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<AttendanceRow>(
        `update public.attendance_sessions set absent_student_ids = '{}' where id = $1
         returning enrolled_count`,
        [first?.id],
      ),
    );
    expect(saved?.enrolled_count).toBe(5);
  });
});
