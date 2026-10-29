import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, type TestDatabase } from './support/database';
import { asUser, createScenario, provisionFamily, type Scenario } from './support/scenario';

type Payload = Record<string, unknown>;

let database: TestDatabase;
let scenario: Scenario;
/** The family of the learner of school B1, in another cluster. */
let otherFamily: string;

beforeAll(async () => {
  database = await createTestDatabase();
  scenario = await createScenario(database);
  otherFamily = await provisionFamily(database.query, scenario.students.b1Active);
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

function today(offsetDays = 0): string {
  const india = new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000);
  return india.toISOString().slice(0, 10);
}

/** A class test of class A1 Grade 1 in Hindi, out of 20, held today, with marks for two children. */
async function markedExam(): Promise<{ examId: string; paperId: string }> {
  const examId = randomUUID();
  const paperId = randomUUID();
  await database.as(asUser(scenario.staff.teacherA1), (query) =>
    query('select public.save_exam($1::jsonb)', [
      JSON.stringify({
        id: examId,
        academic_year_id: scenario.academicYearId,
        kind: 'class_test',
        title: 'Class test 4',
        school_id: scenario.schoolA1Id,
        cluster_id: null,
        starts_on: today(),
        ends_on: today(),
        papers: [
          {
            id: paperId,
            class_section_id: scenario.classA1Grade1Id,
            subject: 'maths',
            held_on: today(),
            scale: 'marks',
            max_marks: 20,
          },
        ],
      }),
    ]),
  );
  await database.as(asUser(scenario.staff.teacherA1), (query) =>
    query('select public.save_exam_marks($1::jsonb)', [
      JSON.stringify({
        paper_id: paperId,
        change_id: randomUUID(),
        base_revision: 0,
        supersedes: [],
        entries: [
          { student_id: scenario.students.a1Active[0], marks: 17 },
          { student_id: scenario.students.a1Active[1], marks: 9 },
        ],
      }),
    ]),
  );
  return { examId, paperId };
}

function share(userId: string, examId: string, classSectionId = scenario.classA1Grade1Id) {
  return database.as(asUser(userId), (query) =>
    query<{ shared_by: string; school_id: string }>(
      `insert into public.exam_result_shares (exam_id, class_section_id, school_id, shared_by)
       values ($1, $2, $3, $4)
       on conflict do nothing
       returning shared_by, school_id`,
      [examId, classSectionId, scenario.schoolB1Id, scenario.staff.superAdmin],
    ),
  );
}

function rows(userId: string, sql: string, params: unknown[] = []) {
  return database.as(asUser(userId), (query) => query(sql, params));
}

describe('shared results', () => {
  it('shows a family nothing until the result is shared, then only their own child', async () => {
    const { examId, paperId } = await markedExam();
    const family = scenario.familyAccountId;
    expect(await rows(family, 'select student_id from public.exam_marks')).toEqual([]);
    expect(await rows(family, 'select id from public.exam_papers')).toEqual([]);

    const [shared] = await share(scenario.staff.teacherA1Colleague, examId);
    // The school and the person who shared it come from the database, not the request.
    expect(shared).toEqual({
      shared_by: scenario.staff.teacherA1Colleague,
      school_id: scenario.schoolA1Id,
    });
    expect(await rows(family, 'select student_id, marks::text from public.exam_marks')).toEqual([
      { student_id: scenario.students.a1Active[0], marks: '17.0' },
    ]);
    expect(await rows(family, 'select id from public.exam_papers')).toEqual([{ id: paperId }]);
    expect(await rows(family, 'select id, title from public.exams')).toEqual([
      { id: examId, title: 'Class test 4' },
    ]);
    // The history of marks and other families stay out of reach.
    expect(await rows(family, 'select id from public.exam_mark_changes')).toEqual([]);
    expect(await rows(otherFamily, 'select student_id from public.exam_marks')).toEqual([]);
    expect(await rows(family, 'select exam_id from public.exam_result_shares')).toEqual([]);

    // Sharing again changes nothing; taking it back hides the marks again.
    expect(await share(scenario.staff.teacherA1, examId)).toEqual([]);
    await rows(
      scenario.staff.crpA,
      'delete from public.exam_result_shares where exam_id = $1 and class_section_id = $2',
      [examId, scenario.classA1Grade1Id],
    );
    expect(await rows(family, 'select student_id from public.exam_marks')).toEqual([]);
  });

  it('lets only the staff of the school share, for a class the exam is held in', async () => {
    const { examId } = await markedExam();
    for (const outsider of [
      scenario.staff.teacherB1,
      scenario.staff.crpB,
      scenario.staff.blockOfficer,
      scenario.familyAccountId,
    ]) {
      expect(await errorCodeOf(share(outsider, examId))).toBe('42501');
    }
    expect(
      await errorCodeOf(share(scenario.staff.teacherA1, examId, scenario.classA1Grade2Id)),
    ).toBe('23503');
    // A shared result is never changed in place.
    await share(scenario.staff.teacherA1, examId);
    expect(
      await errorCodeOf(
        rows(scenario.staff.teacherA1, 'update public.exam_result_shares set shared_at = now()'),
      ),
    ).toBe('42501');
    expect(
      await rows(
        scenario.familyAccountId,
        'delete from public.exam_result_shares returning exam_id',
      ),
    ).toEqual([]);
  });

  it('shows a correction made after sharing, and an absence', async () => {
    const { examId, paperId } = await markedExam();
    await share(scenario.staff.teacherA1, examId);
    const [paper] = await database.query<{ revision: number }>(
      'select revision from public.exam_papers where id = $1',
      [paperId],
    );
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select public.save_exam_marks($1::jsonb)', [
        JSON.stringify({
          paper_id: paperId,
          change_id: randomUUID(),
          base_revision: paper?.revision,
          supersedes: [],
          entries: [
            { student_id: scenario.students.a1Active[0], absent: true },
            { student_id: scenario.students.a1Active[1], marks: 9 },
          ],
        }),
      ]),
    );
    expect(
      await rows(scenario.familyAccountId, 'select marks, absent from public.exam_marks'),
    ).toEqual([{ marks: null, absent: true }]);
  });

  it('ends access when the family sign-in is switched off', async () => {
    const { examId } = await markedExam();
    await share(scenario.staff.teacherA1, examId);
    await database.query('update public.profiles set is_active = false where id = $1', [
      scenario.familyAccountId,
    ]);
    expect(
      await rows(scenario.familyAccountId, 'select student_id from public.exam_marks'),
    ).toEqual([]);
  });
});

describe("the family's attendance", () => {
  function mark(daysAgo: number, absent: string[]) {
    return rows(
      scenario.staff.teacherA1,
      `insert into public.attendance_sessions
         (class_section_id, attendance_date, absent_student_ids, enrolled_count)
       values ($1, private.today() - $2::int, $3::uuid[], 0)`,
      [scenario.classA1Grade1Id, daysAgo, absent],
    );
  }

  it("returns only the child's own days, present or absent", async () => {
    await mark(2, [scenario.students.a1Active[0]]);
    await mark(1, [scenario.students.a1Active[1]]);
    await mark(0, []);
    const days = await rows(
      scenario.familyAccountId,
      'select attendance_date::text, present from public.my_attendance()',
    );
    expect(days).toEqual([
      { attendance_date: today(-2), present: false },
      { attendance_date: today(-1), present: true },
      { attendance_date: today(), present: true },
    ]);
    expect(
      await rows(
        scenario.familyAccountId,
        'select attendance_date from public.my_attendance(private.today())',
      ),
    ).toHaveLength(1);
    // Staff accounts and other families receive nothing.
    expect(await rows(scenario.staff.teacherA1, 'select * from public.my_attendance()')).toEqual(
      [],
    );
    expect(await rows(otherFamily, 'select * from public.my_attendance()')).toEqual([]);
  });

  it('counts only the days the child was on the roll', async () => {
    await mark(3, []);
    await database.query(
      'update public.enrolments set enrolled_on = private.today() - 1 where student_id = $1',
      [scenario.students.a1Active[0]],
    );
    await mark(0, []);
    expect(
      await rows(
        scenario.familyAccountId,
        'select attendance_date::text from public.my_attendance()',
      ),
    ).toEqual([{ attendance_date: today() }]);
  });
});

describe('class notes', () => {
  function sendNote(userId: string, note: Payload = {}) {
    return rows(
      userId,
      `insert into public.class_notes
         (id, class_section_id, school_id, kind, body, due_on, attachment_path, attachment_type,
          attachment_bytes, attachment_name, author_id, author_name)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, 'Someone else')
       on conflict do nothing
       returning school_id, author_id, author_name, body, attachment_type, attachment_bytes`,
      [
        note.id ?? randomUUID(),
        note.class_section_id ?? scenario.classA1Grade1Id,
        scenario.schoolB1Id,
        note.kind ?? 'message',
        note.body ?? '  Bring a leaf to class tomorrow.  ',
        note.due_on ?? null,
        note.attachment_path ?? null,
        note.attachment_type ?? null,
        note.attachment_bytes ?? null,
        note.attachment_name ?? null,
        scenario.staff.superAdmin,
      ],
    );
  }

  function upload(userId: string, path: string, size = 200_000, mimetype = 'image/jpeg') {
    return rows(
      userId,
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('class-notes', $1, auth.uid()::text, $2::jsonb)`,
      [path, JSON.stringify({ size, mimetype })],
    );
  }

  function visibleFiles(userId: string) {
    return rows(userId, "select name from storage.objects where bucket_id = 'class-notes'");
  }

  it('reaches the families of the class, signed by the teacher who sent it', async () => {
    const [note] = await sendNote(scenario.staff.teacherA1);
    expect(note).toEqual({
      school_id: scenario.schoolA1Id,
      author_id: scenario.staff.teacherA1,
      author_name: 'Teacher A1',
      body: 'Bring a leaf to class tomorrow.',
      attachment_type: null,
      attachment_bytes: null,
    });
    expect(
      await rows(scenario.familyAccountId, 'select body from public.class_notes'),
    ).toHaveLength(1);
    for (const outsider of [otherFamily, scenario.staff.teacherB1, scenario.staff.blockOfficer]) {
      expect(await rows(outsider, 'select id from public.class_notes')).toEqual([]);
    }
    // The cluster's CRP reads the notes of its schools.
    expect(await rows(scenario.staff.crpA, 'select id from public.class_notes')).toHaveLength(1);
  });

  it('is sent only by teachers of the school, and is the same when sent again', async () => {
    for (const outsider of [
      scenario.staff.teacherB1,
      scenario.staff.crpA,
      scenario.familyAccountId,
    ]) {
      expect(await errorCodeOf(sendNote(outsider))).toBe('42501');
    }
    const id = randomUUID();
    await sendNote(scenario.staff.teacherA1, { id });
    expect(await sendNote(scenario.staff.teacherA1, { id, body: 'Changed' })).toEqual([]);
    const [held] = await database.query<{ body: string }>(
      'select body from public.class_notes where id = $1',
      [id],
    );
    expect(held?.body).toBe('Bring a leaf to class tomorrow.');
    expect(
      await errorCodeOf(
        rows(scenario.staff.teacherA1, "update public.class_notes set body = 'Changed'"),
      ),
    ).toBe('42501');
  });

  it('checks homework dates, empty notes and the daily limit', async () => {
    await sendNote(scenario.staff.teacherA1, { kind: 'homework', due_on: today(2) });
    // Written without a network, homework may arrive after its day; it is kept as written.
    await sendNote(scenario.staff.teacherA1, { kind: 'homework', due_on: today(-3) });
    for (const due of [today(-15), today(61)]) {
      expect(
        await errorCodeOf(sendNote(scenario.staff.teacherA1, { kind: 'homework', due_on: due })),
      ).toBe('23514');
    }
    expect(
      await errorCodeOf(sendNote(scenario.staff.teacherA1, { kind: 'message', due_on: today(1) })),
    ).toBe('23514');
    expect(await errorCodeOf(sendNote(scenario.staff.teacherA1, { body: '   ' }))).toBe('23514');
    for (let sent = 2; sent < 30; sent += 1) {
      await sendNote(scenario.staff.teacherA1Colleague);
    }
    expect(await errorCodeOf(sendNote(scenario.staff.teacherA1))).toBe('23514');
    // Another class of the school is not affected.
    await sendNote(scenario.staff.teacherA1, { class_section_id: scenario.classA1Grade2Id });
  });

  it("takes a file's type and size from storage and shows it to the class's families", async () => {
    const id = randomUUID();
    const path = `${scenario.classA1Grade1Id}/${id}.jpg`;
    await upload(scenario.staff.teacherA1, path, 345_678);
    // Until a note carries it, a file is not shown to families.
    expect(await visibleFiles(scenario.familyAccountId)).toEqual([]);
    const [note] = await sendNote(scenario.staff.teacherA1, {
      id,
      attachment_path: path,
      attachment_type: 'application/pdf',
      attachment_bytes: 1,
      attachment_name: 'Leaf.jpg',
    });
    expect(note).toMatchObject({ attachment_type: 'image/jpeg', attachment_bytes: 345_678 });
    expect(await visibleFiles(scenario.familyAccountId)).toEqual([{ name: path }]);
    expect(await visibleFiles(otherFamily)).toEqual([]);
    expect(await visibleFiles(scenario.staff.teacherB1)).toEqual([]);
  });

  it('refuses files of another class, another teacher or the wrong type', async () => {
    const id = randomUUID();
    expect(
      await errorCodeOf(upload(scenario.staff.teacherB1, `${scenario.classA1Grade1Id}/${id}.jpg`)),
    ).toBe('42501');
    expect(
      await errorCodeOf(upload(scenario.staff.teacherA1, `${scenario.classA1Grade1Id}/leaf.jpg`)),
    ).toBe('42501');
    expect(
      await errorCodeOf(upload(scenario.familyAccountId, `${scenario.classA1Grade1Id}/${id}.jpg`)),
    ).toBe('42501');

    // Stored by a colleague: the note must be sent by whoever stored its file.
    const path = `${scenario.classA1Grade1Id}/${id}.jpg`;
    await upload(scenario.staff.teacherA1Colleague, path);
    expect(
      await errorCodeOf(
        sendNote(scenario.staff.teacherA1, {
          id,
          attachment_path: path,
          attachment_type: 'image/jpeg',
          attachment_bytes: 1,
        }),
      ),
    ).toBe('42501');

    // The extension must match the type storage holds.
    const pdf = randomUUID();
    const wrong = `${scenario.classA1Grade1Id}/${pdf}.jpg`;
    await upload(scenario.staff.teacherA1, wrong, 50_000, 'application/pdf');
    expect(
      await errorCodeOf(
        sendNote(scenario.staff.teacherA1, {
          id: pdf,
          attachment_path: wrong,
          attachment_type: 'image/jpeg',
          attachment_bytes: 1,
        }),
      ),
    ).toBe('23514');

    // A file that was never stored.
    const missing = randomUUID();
    expect(
      await errorCodeOf(
        sendNote(scenario.staff.teacherA1, {
          id: missing,
          attachment_path: `${scenario.classA1Grade1Id}/${missing}.png`,
          attachment_type: 'image/png',
          attachment_bytes: 1,
        }),
      ),
    ).toBe('23514');
  });

  it("is removed by the school's teachers, and its file after it", async () => {
    const id = randomUUID();
    const path = `${scenario.classA1Grade1Id}/${id}.pdf`;
    await upload(scenario.staff.teacherA1, path, 80_000, 'application/pdf');
    await sendNote(scenario.staff.teacherA1, {
      id,
      attachment_path: path,
      attachment_type: 'application/pdf',
      attachment_bytes: 1,
    });
    const removeFile = (userId: string) =>
      rows(
        userId,
        "delete from storage.objects where bucket_id = 'class-notes' and name = $1 returning name",
        [path],
      );
    // A file stays while its note does.
    expect(await removeFile(scenario.staff.teacherA1)).toEqual([]);
    for (const outsider of [
      scenario.familyAccountId,
      scenario.staff.crpA,
      scenario.staff.teacherB1,
    ]) {
      expect(await rows(outsider, 'delete from public.class_notes returning id')).toEqual([]);
    }
    expect(
      await rows(scenario.staff.teacherA1Colleague, 'delete from public.class_notes returning id'),
    ).toEqual([{ id }]);
    expect(await removeFile(scenario.staff.teacherB1)).toEqual([]);
    expect(await removeFile(scenario.staff.teacherA1Colleague)).toEqual([{ name: path }]);

    // The author's phone sends the note again, its first answer lost: it stays removed.
    await sendNote(scenario.staff.teacherA1, { id });
    expect(await rows(scenario.staff.teacherA1, 'select id from public.class_notes')).toEqual([]);
  });

  it('tells a teacher of another school nothing about its classes', async () => {
    const { examId } = await markedExam();
    for (let sent = 0; sent < 30; sent += 1) {
      await sendNote(scenario.staff.teacherA1);
    }
    // Refused for want of permission, before the class's limit or the exam's papers are looked at.
    expect(await errorCodeOf(sendNote(scenario.staff.teacherB1))).toBe('42501');
    expect(
      await errorCodeOf(share(scenario.staff.teacherB1, examId, scenario.classA1Grade2Id)),
    ).toBe('42501');
  });

  it("follows the child's class: a family no longer reads the notes of a class left", async () => {
    await sendNote(scenario.staff.teacherA1);
    await database.query(
      'update public.enrolments set ended_on = private.today() where student_id = $1',
      [scenario.students.a1Active[0]],
    );
    expect(await rows(scenario.familyAccountId, 'select id from public.class_notes')).toEqual([]);
  });
});
