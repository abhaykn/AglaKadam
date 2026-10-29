import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, type TestDatabase } from './support/database';
import { asUser, createScenario, insertStudent, type Scenario } from './support/scenario';

let database: TestDatabase;
let scenario: Scenario;
/** Whether a few days from now still fall in the current session, as some tests need. */
let roomInSession = true;

beforeAll(async () => {
  database = await createTestDatabase();
  scenario = await createScenario(database);
  const [year] = await database.query<{ room: boolean }>(
    `select ends_on >= private.today() + 10 as room from public.academic_years where id = $1`,
    [scenario.academicYearId],
  );
  roomInSession = year?.room ?? true;
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

const service = { kind: 'service' } as const;

type Payload = Record<string, unknown>;

function today(offsetDays = 0): string {
  const india = new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000);
  return india.toISOString().slice(0, 10);
}

/** A class test of class A1 Grade 1 in Hindi, out of 20, held today. */
function classTest(overrides: Payload = {}, paper: Payload = {}): Payload {
  return {
    id: randomUUID(),
    academic_year_id: scenario.academicYearId,
    kind: 'class_test',
    title: 'Class test 3',
    school_id: scenario.schoolA1Id,
    cluster_id: null,
    starts_on: today(),
    ends_on: today(),
    papers: [
      {
        id: randomUUID(),
        class_section_id: scenario.classA1Grade1Id,
        subject: 'hindi',
        held_on: today(),
        scale: 'marks',
        max_marks: 20,
        ...paper,
      },
    ],
    ...overrides,
  };
}

function saveExam(userId: string, exam: Payload) {
  return database.as(asUser(userId), (query) =>
    query('select public.save_exam($1::jsonb)', [JSON.stringify(exam)]),
  );
}

function firstPaper(exam: Payload): string {
  return String((exam.papers as Payload[])[0]?.id);
}

/** Saves marks as a device does; every save carries a new change identifier unless given one. */
function saveMarks(userId: string, payload: Payload) {
  return database.as(asUser(userId), (query) =>
    query<{ revision: number }>('select public.save_exam_marks($1::jsonb) as revision', [
      JSON.stringify({ change_id: randomUUID(), supersedes: [], ...payload }),
    ]),
  );
}

async function savedMarks(userId: string, payload: Payload): Promise<number> {
  const [row] = await saveMarks(userId, payload);
  return Number(row?.revision);
}

function marksOf(paperId: string) {
  return database.query<{ student_id: string; marks: string | null; absent: boolean }>(
    'select student_id, marks::text, absent from public.exam_marks where paper_id = $1 order by student_id',
    [paperId],
  );
}

function visibleIds(userId: string, table: string) {
  return database
    .as(asUser(userId), (query) => query<{ id: string }>(`select id from public.${table}`))
    .then((rows) => rows.map((row) => row.id));
}

describe('scheduling', () => {
  it('lets a teacher schedule a test for a class of their school, seen by the school and its CRP', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const [row] = await database.query<{ created_by: string }>(
      'select created_by from public.exams where id = $1',
      [exam.id],
    );
    expect(row?.created_by).toBe(scenario.staff.teacherA1);
    for (const reader of [
      scenario.staff.teacherA1,
      scenario.staff.teacherA1Colleague,
      scenario.staff.crpA,
    ]) {
      expect(await visibleIds(reader, 'exams')).toEqual([exam.id]);
      expect(await visibleIds(reader, 'exam_papers')).toEqual([firstPaper(exam)]);
    }
    // Other schools, other clusters and the block office see nothing.
    for (const other of [
      scenario.staff.teacherA2,
      scenario.staff.teacherB1,
      scenario.staff.crpB,
      scenario.staff.blockOfficer,
      scenario.staff.districtOfficer,
      scenario.familyAccountId,
    ]) {
      expect(await visibleIds(other, 'exams')).toEqual([]);
      expect(await visibleIds(other, 'exam_papers')).toEqual([]);
    }
    // Sending the same exam again changes nothing.
    await saveExam(scenario.staff.teacherA1, exam);
    expect(await visibleIds(scenario.staff.teacherA1, 'exam_papers')).toEqual([firstPaper(exam)]);
  });

  it('lets a CRP schedule an exam for every class of the cluster', async ({ skip }) => {
    skip(!roomInSession, 'The session ends within days.');
    const exam = {
      ...classTest({ kind: 'half_yearly', title: null, school_id: null }),
      cluster_id: scenario.clusterAId,
      ends_on: today(5),
      papers: [
        {
          id: randomUUID(),
          class_section_id: scenario.classA1Grade1Id,
          subject: 'english',
          held_on: today(1),
          scale: 'marks',
          max_marks: 50,
        },
        {
          id: randomUUID(),
          class_section_id: scenario.classA1Grade2Id,
          subject: 'other',
          subject_name: 'Art',
          held_on: today(2),
          scale: 'grades',
        },
      ],
    };
    await saveExam(scenario.staff.crpA, exam);
    expect((await visibleIds(scenario.staff.teacherA1, 'exam_papers')).length).toBe(2);
    // A teacher cannot change the CRP's exam, but may move their class's paper within its dates.
    expect(await errorCodeOf(saveExam(scenario.staff.teacherA1, { ...exam, title: 'Mine' }))).toBe(
      '42501',
    );
    const paper = (exam.papers[0] as Payload).id;
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select public.move_exam_paper($1, $2::date, null)', [paper, today(3)]),
    );
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query('select public.move_exam_paper($1, $2::date, null)', [paper, today(9)]),
        ),
      ),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherB1), (query) =>
          query('select public.move_exam_paper($1, $2::date, null)', [paper, today(3)]),
        ),
      ),
    ).toBe('42501');
    // A paper for a class outside the cluster is refused: the CRP cannot even see that class.
    expect(
      await errorCodeOf(
        saveExam(scenario.staff.crpA, {
          ...exam,
          id: randomUUID(),
          papers: [
            {
              id: randomUUID(),
              class_section_id: scenario.classB1Grade1Id,
              subject: 'maths',
              held_on: today(1),
              scale: 'marks',
              max_marks: 50,
            },
          ],
        }),
      ),
    ).toBe('23503');
  });

  it("keeps exams to the scheduler's own school or cluster, its session and its dates", async () => {
    expect(await errorCodeOf(saveExam(scenario.staff.teacherB1, classTest()))).toBe('42501');
    expect(
      await errorCodeOf(
        saveExam(scenario.staff.crpB, {
          ...classTest({ school_id: null }),
          cluster_id: scenario.clusterAId,
        }),
      ),
    ).toBe('42501');
    expect(await errorCodeOf(saveExam(scenario.staff.blockOfficer, classTest()))).toBe('42501');
    // A paper outside the exam's dates, or an exam that began too long ago.
    expect(
      await errorCodeOf(saveExam(scenario.staff.teacherA1, classTest({}, { held_on: today(1) }))),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        saveExam(
          scenario.staff.teacherA1,
          classTest({ starts_on: today(-70), ends_on: today(-70) }, { held_on: today(-70) }),
        ),
      ),
    ).toBe('23514');
    // A paper marked out of nothing, or graded with a maximum.
    expect(
      await errorCodeOf(saveExam(scenario.staff.teacherA1, classTest({}, { max_marks: null }))),
    ).toBe('23514');
    // An exam is written through save_exam only.
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(
            `insert into public.exams (id, academic_year_id, kind, school_id, starts_on, ends_on)
             values (gen_random_uuid(), $1, 'class_test', $2, private.today(), private.today())`,
            [scenario.academicYearId, scenario.schoolA1Id],
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('removes papers and exams only while they have no marks', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    await savedMarks(scenario.staff.teacherA1, {
      paper_id: firstPaper(exam),
      base_revision: 0,
      entries: [{ student_id: scenario.students.a1Active[0], marks: 15 }],
    });
    expect(
      await errorCodeOf(
        saveExam(scenario.staff.teacherA1, {
          ...exam,
          papers: [
            {
              id: randomUUID(),
              class_section_id: scenario.classA1Grade1Id,
              subject: 'maths',
              held_on: today(),
              scale: 'marks',
              max_marks: 20,
            },
          ],
        }),
      ),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query('select public.remove_exam($1)', [exam.id]),
        ),
      ),
    ).toBe('23514');

    const empty = classTest();
    await saveExam(scenario.staff.teacherA1, empty);
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherB1), (query) =>
          query('select public.remove_exam($1)', [empty.id]),
        ),
      ),
    ).toBe('42501');
    // A colleague at the same school manages it as well, so it outlives its author's posting.
    await database.as(asUser(scenario.staff.teacherA1Colleague), (query) =>
      query('select public.remove_exam($1)', [empty.id]),
    );
    expect(await visibleIds(scenario.staff.teacherA1, 'exams')).toEqual([exam.id]);

    // Exams, papers and marks are never removed around the functions.
    for (const sql of [
      'delete from public.exams where id = $1',
      'delete from public.exam_papers where exam_id = $1',
      `delete from public.exam_marks where paper_id in
         (select id from public.exam_papers where exam_id = $1)`,
    ]) {
      expect(
        await errorCodeOf(
          database.as(asUser(scenario.staff.teacherA1), (query) => query(sql, [exam.id])),
        ),
      ).toBe('42501');
    }
    expect(await marksOf(firstPaper(exam))).toHaveLength(1);
  });

  it('keeps the day of a paper with marks, and its history after the marks are cleared', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const paper = firstPaper(exam);
    const child = scenario.students.a1Active[0];
    const revision = await savedMarks(scenario.staff.teacherA1, {
      paper_id: paper,
      base_revision: 0,
      entries: [{ student_id: child, marks: 15 }],
    });
    // Its 60 days cannot start again by moving it, nor can it move to a day to come.
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query('select public.move_exam_paper($1, $2::date, null)', [paper, today(-1)]),
        ),
      ),
    ).toBe('23514');
    // A larger maximum changes what the marks mean: devices that read them before must re-read.
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select public.move_exam_paper($1, $2::date, 25::smallint)', [paper, today()]),
    );
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1Colleague, {
          paper_id: paper,
          base_revision: revision,
          entries: [{ student_id: child, marks: 16 }],
        }),
      ),
    ).toBe('40001');
    // A colleague clears the mark: the history stays, and so does the exam.
    const [paperRow] = await database.query<{ revision: number }>(
      'select revision from public.exam_papers where id = $1',
      [paper],
    );
    await savedMarks(scenario.staff.teacherA1Colleague, {
      paper_id: paper,
      base_revision: paperRow?.revision,
      entries: [],
    });
    expect(await marksOf(paper)).toEqual([]);
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query('select public.remove_exam($1)', [exam.id]),
        ),
      ),
    ).toBe('23514');
  });

  it('keeps the papers a school has moved when the same exam is sent again', async ({ skip }) => {
    skip(!roomInSession, 'The session ends within days.');
    const exam: Payload = {
      ...classTest({ school_id: null, ends_on: today(5) }),
      cluster_id: scenario.clusterAId,
    };
    await saveExam(scenario.staff.crpA, exam);
    const paper = firstPaper(exam);
    const [sent] = exam.papers as Payload[];
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select public.move_exam_paper($1, $2::date, 30::smallint)', [paper, today(4)]),
    );
    // A teacher of another school of the cluster cannot move it.
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA2), (query) =>
          query('select public.move_exam_paper($1, $2::date, null)', [paper, today(2)]),
        ),
      ),
    ).toBe('42501');
    await saveExam(scenario.staff.crpA, exam);
    const [row] = await database.query<{ held_on: string; max_marks: number }>(
      'select held_on::text, max_marks from public.exam_papers where id = $1',
      [paper],
    );
    expect(row).toEqual({ held_on: today(4), max_marks: 30 });
    // A paper cannot change its class or subject.
    expect(
      await errorCodeOf(
        saveExam(scenario.staff.crpA, {
          ...exam,
          papers: [{ ...sent, subject: 'maths' }],
        }),
      ),
    ).toBe('23514');
  });
});

describe('marks', () => {
  it("are entered by the school's teachers, read by the school and its CRP, and no one else", async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const paper = firstPaper(exam);
    const [first, second, third] = scenario.students.a1Active;
    const revision = await savedMarks(scenario.staff.teacherA1Colleague, {
      paper_id: paper,
      base_revision: 0,
      entries: [
        { student_id: first, marks: 17.5 },
        { student_id: second, absent: true },
        // A child of another school is ignored, not refused.
        { student_id: scenario.students.b1Active, marks: 3 },
      ],
    });
    expect(revision).toBe(1);
    expect((await marksOf(paper)).map((row) => [row.student_id, row.marks, row.absent])).toEqual(
      [
        [first, '17.5', false],
        [second, null, true],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    const read = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query<{ student_id: string }>('select student_id from public.exam_marks'),
      );
    expect(await read(scenario.staff.crpA)).toHaveLength(2);
    for (const other of [
      scenario.staff.teacherB1,
      scenario.staff.crpB,
      scenario.staff.blockOfficer,
      scenario.familyAccountId,
    ]) {
      expect(await read(other)).toEqual([]);
    }
    // A CRP or a teacher of another school does not enter marks.
    for (const outsider of [scenario.staff.crpA, scenario.staff.teacherB1]) {
      expect(
        await errorCodeOf(
          saveMarks(outsider, {
            paper_id: paper,
            base_revision: revision,
            entries: [{ student_id: third, marks: 10 }],
          }),
        ),
      ).toBe('42501');
    }
    // Marks are written through save_exam_marks only.
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(`update public.exam_marks set marks = 20 where paper_id = $1`, [paper]),
        ),
      ),
    ).toBe('42501');
  });

  it('refuses marks out of range, of the wrong kind, or before the paper', async ({ skip }) => {
    skip(!roomInSession, 'The session ends within days.');
    const exam = classTest({ ends_on: today(2) });
    await saveExam(scenario.staff.teacherA1, exam);
    const paper = firstPaper(exam);
    const child = scenario.students.a1Active[0];
    for (const entry of [
      { student_id: child, marks: 21 },
      { student_id: child, marks: -1 },
      { student_id: child, grade: 'A' },
      { student_id: child },
    ]) {
      expect(
        await errorCodeOf(
          saveMarks(scenario.staff.teacherA1, {
            paper_id: paper,
            base_revision: 0,
            entries: [entry],
          }),
        ),
      ).toBe('23514');
    }
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1, {
          paper_id: paper,
          base_revision: 0,
          entries: [{ student_id: child, marks: 10.25 }],
        }),
      ),
    ).toBe('23514');

    const later = classTest({ ends_on: today(3) }, { held_on: today(2) });
    await saveExam(scenario.staff.teacherA1, later);
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1, {
          paper_id: firstPaper(later),
          base_revision: 0,
          entries: [{ student_id: child, marks: 10 }],
        }),
      ),
    ).toBe('23514');

    // A graded paper takes grades.
    const graded = classTest({}, { scale: 'grades', max_marks: null });
    await saveExam(scenario.staff.teacherA1, graded);
    await savedMarks(scenario.staff.teacherA1, {
      paper_id: firstPaper(graded),
      base_revision: 0,
      entries: [{ student_id: child, grade: 'B' }],
    });
    // The maximum cannot drop below a mark given.
    await savedMarks(scenario.staff.teacherA1, {
      paper_id: paper,
      base_revision: 0,
      entries: [{ student_id: child, marks: 18 }],
    });
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query('select public.move_exam_paper($1, $2::date, 15::smallint)', [paper, today()]),
        ),
      ),
    ).toBe('23514');
  });

  it('refuses to overwrite marks saved on another device, and applies a resent save once', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const paper = firstPaper(exam);
    const child = scenario.students.a1Active[0];
    const change = randomUUID();
    const entries = [{ student_id: child, marks: 12 }];
    expect(
      await savedMarks(scenario.staff.teacherA1, {
        paper_id: paper,
        base_revision: 0,
        change_id: change,
        entries,
      }),
    ).toBe(1);
    // The answer was lost and the same save arrives again: nothing changes.
    expect(
      await savedMarks(scenario.staff.teacherA1, {
        paper_id: paper,
        base_revision: 0,
        change_id: change,
        entries: [],
      }),
    ).toBe(1);
    expect(await marksOf(paper)).toHaveLength(1);
    // The device's own later save builds on its first.
    expect(
      await savedMarks(scenario.staff.teacherA1, {
        paper_id: paper,
        base_revision: 0,
        supersedes: [change],
        entries: [{ student_id: child, marks: 13 }],
      }),
    ).toBe(2);
    // Another device that started from the first revision is refused.
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1Colleague, {
          paper_id: paper,
          base_revision: 1,
          entries,
        }),
      ),
    ).toBe('40001');
  });

  it('asks to send again later for a paper not on the server yet', async () => {
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1, {
          paper_id: randomUUID(),
          base_revision: 0,
          entries: [],
        }),
      ),
    ).toBe('55000');
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherB1, {
          paper_id: firstPaper(exam),
          base_revision: 0,
          entries: [],
        }),
      ),
    ).toBe('42501');
  });

  it('takes each child once, and marks only in steps of a half as sent', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const child = scenario.students.a1Active[0];
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1, {
          paper_id: firstPaper(exam),
          base_revision: 0,
          entries: [
            { student_id: child, marks: 10 },
            { student_id: child, marks: 12 },
          ],
        }),
      ),
    ).toBe('22023');
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1, {
          paper_id: firstPaper(exam),
          base_revision: 0,
          entries: [{ student_id: child, marks: 10.04 }],
        }),
      ),
    ).toBe('23514');
  });

  it('lets a child with marks be removed, with their marks', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const pending = scenario.students.a1Pending;
    await database.query(
      `update public.enrolments set enrolled_on = private.today() - 5 where student_id = $1`,
      [pending],
    );
    await savedMarks(scenario.staff.teacherA1, {
      paper_id: firstPaper(exam),
      base_revision: 0,
      entries: [{ student_id: pending, marks: 9 }],
    });
    await database.query('delete from public.students where id = $1', [pending]);
    expect(await marksOf(firstPaper(exam))).toEqual([]);
  });

  it('closes a paper to teachers 60 days after it', async () => {
    const examId = randomUUID();
    const paperId = randomUUID();
    await database.query(
      `insert into public.exams (id, academic_year_id, kind, school_id, starts_on, ends_on)
       values ($1, $2, 'unit_test', $3, private.today() - 61, private.today() - 61)`,
      [examId, scenario.academicYearId, scenario.schoolA1Id],
    );
    await database.query(
      `insert into public.exam_papers (id, exam_id, class_section_id, school_id, subject, held_on,
         scale, max_marks)
       values ($1, $2, $3, $4, 'maths', private.today() - 61, 'marks', 25)`,
      [paperId, examId, scenario.classA1Grade1Id, scenario.schoolA1Id],
    );
    expect(
      await errorCodeOf(
        saveMarks(scenario.staff.teacherA1, {
          paper_id: paperId,
          base_revision: 0,
          entries: [{ student_id: scenario.students.a1Active[0], marks: 20 }],
        }),
      ),
    ).toBe('42501');
  });

  it('keeps the history of marks changed later or by someone else, not of typing', async () => {
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const paper = firstPaper(exam);
    const [first, second] = scenario.students.a1Active;
    let revision = await savedMarks(scenario.staff.teacherA1, {
      paper_id: paper,
      base_revision: 0,
      entries: [
        { student_id: first, marks: 10 },
        { student_id: second, marks: 8 },
      ],
    });
    // The same teacher corrects a mark at once: no history.
    revision = await savedMarks(scenario.staff.teacherA1, {
      paper_id: paper,
      base_revision: revision,
      entries: [
        { student_id: first, marks: 11 },
        { student_id: second, marks: 8 },
      ],
    });
    const history = () =>
      database.as(asUser(scenario.staff.crpA), (query) =>
        query<{
          student_id: string;
          old_marks: string;
          new_marks: string | null;
          removed: boolean;
        }>(
          `select student_id, old_marks::text, new_marks::text, removed
           from public.exam_mark_changes order by id`,
        ),
      );
    expect(await history()).toEqual([]);
    // A colleague changes one mark, and a day later the teacher removes the other.
    revision = await savedMarks(scenario.staff.teacherA1Colleague, {
      paper_id: paper,
      base_revision: revision,
      entries: [
        { student_id: first, marks: 16 },
        { student_id: second, marks: 8 },
      ],
    });
    await database.query(
      `update public.exam_marks set entered_at = now() - interval '2 days'
       where paper_id = $1 and student_id = $2`,
      [paper, second],
    );
    await savedMarks(scenario.staff.teacherA1, {
      paper_id: paper,
      base_revision: revision,
      entries: [{ student_id: first, marks: 16 }],
    });
    expect(await history()).toEqual([
      { student_id: first, old_marks: '11.0', new_marks: '16.0', removed: false },
      { student_id: second, old_marks: '8.0', new_marks: null, removed: true },
    ]);
    expect(
      await database.as(asUser(scenario.staff.teacherB1), (query) =>
        query('select id from public.exam_mark_changes'),
      ),
    ).toEqual([]);
  });
});

describe('marks beside Pulse', () => {
  /** A recorded Pulse check of a child of class A1 Grade 1 this month, with the engine's levels. */
  async function heard(
    studentId: string,
    position: number,
    teacherReading: string,
    engineReading: string | null,
  ) {
    const [cycle] = await database.query<{ id: string }>(
      `insert into public.pulse_cycles (class_section_id, month, grade, language, first_week,
         eligible_count, sample_size, reserve_size)
       values ($1, date_trunc('month', private.today())::date, 1, 'hi', 1, 3, 3, 0)
       on conflict (class_section_id, month) do update set sample_size = excluded.sample_size
       returning id`,
      [scenario.classA1Grade1Id],
    );
    const [sample] = await database.query<{ id: string }>(
      `insert into public.pulse_samples (cycle_id, class_section_id, student_id, draw_position,
         week, opens_on, due_on, adapted)
       values ($1, $2, $3, $4, 1, private.today() - 3, private.today() + 3, false)
       returning id`,
      [cycle?.id, scenario.classA1Grade1Id, studentId, position],
    );
    const id = randomUUID();
    const path = `${scenario.classA1Grade1Id}/${String(sample?.id)}/${id}.webm`;
    await database.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('pulse-audio', $1, $2, '{"size": 1000, "mimetype": "audio/webm"}')`,
      [path, scenario.staff.teacherA1],
    );
    await database.query(
      `insert into public.pulse_checks (id, sample_id, class_section_id, student_id, item_code,
         prompt_code, item, audio_path, audio_type, audio_bytes, duration_ms, reading_level,
         english_level, clarity, classroom, recorded_at, received_at)
       values ($1, $2, $3, $4, 'hi-g1-p01', 'en-g1-s01', '{"shown": []}', $5, '', 0, 58000, $6,
         'words', 'clear', 'normal', now() - interval '1 day', now() - interval '1 day')`,
      [id, sample?.id, scenario.classA1Grade1Id, studentId, path, teacherReading],
    );
    if (engineReading) {
      await database.as(service, (query) =>
        query(
          `insert into public.pulse_scores (check_id, class_section_id, engine_version,
             reading_level, reached_level, reading_items, reading_correct, reading_seconds, wcpm,
             english_level, english_words, english_seconds, keyword_hits, other_language_share,
             confidence, flags)
           values ($1, $2, 'pulse-engine 1.0', $3, 'words', 10, 6, 20, null, 'words', 2, 10, 1, 0,
             0.8, '{}')`,
          [id, scenario.classA1Grade1Id, engineReading],
        ),
      );
    }
    return id;
  }

  it('shows the CRP where high marks meet weak reading, and flags the paper', async () => {
    const [first, second, third] = scenario.students.a1Active;
    const fourth = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Learner Four',
      classSectionId: scenario.classA1Grade1Id,
    });
    // The teacher heard all four as fluent; the engine heard two of them struggling.
    await heard(first, 1, 'fluent', 'needs_support');
    await heard(second, 2, 'fluent', 'needs_support');
    await heard(third, 3, 'fluent', 'fluent');
    await heard(fourth, 4, 'fluent', null);
    const exam = classTest();
    await saveExam(scenario.staff.teacherA1, exam);
    const paper = firstPaper(exam);
    await savedMarks(scenario.staff.teacherA1, {
      paper_id: paper,
      base_revision: 0,
      entries: [first, second, third, fourth].map((student_id) => ({ student_id, marks: 19 })),
    });

    const pairs = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ student_id: string; percent: string; pulse_level: string; source: string }>(
        `select student_id, percent::text, pulse_level, source from public.exam_marks_pulse($1)
         order by source, pulse_level`,
        [paper],
      ),
    );
    expect(pairs.map((row) => [row.pulse_level, row.source])).toEqual([
      ['fluent', 'engine'],
      ['needs_support', 'engine'],
      ['needs_support', 'engine'],
      // Without the engine's score, only the teacher's own level is known.
      ['fluent', 'teacher'],
    ]);
    expect(pairs[0]?.percent).toBe('95.0');

    const [check] = await database.as(asUser(scenario.staff.crpA), (query) =>
      query('select * from public.exam_marks_checks(null)'),
    );
    expect(check).toMatchObject({
      paper_id: paper,
      compared: 3,
      high_marks: 3,
      high_but_weak: 2,
      low_but_strong: 0,
      flagged: true,
    });
    // It counts in the week's plan.
    const signal = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ class_section_id: string; marks_to_discuss: number }>(
        'select class_section_id, marks_to_discuss from public.crp_class_signal()',
      ),
    );
    expect(
      signal.find((row) => row.class_section_id === scenario.classA1Grade1Id)?.marks_to_discuss,
    ).toBe(1);

    // The CRP's own listening replaces the engine; teachers and other CRPs see none of this.
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query(
        `insert into public.pulse_reviews (check_id, class_section_id, reading_level, english_level)
         select k.id, k.class_section_id, 'fluent', 'words' from public.pulse_checks as k
         where k.student_id = $1`,
        [first],
      ),
    );
    const [after] = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ flagged: boolean; high_but_weak: number }>(
        'select flagged, high_but_weak from public.exam_marks_checks(private.today() - 30)',
      ),
    );
    expect(after).toEqual({ flagged: false, high_but_weak: 1 });
    for (const other of [scenario.staff.teacherA1, scenario.staff.crpB]) {
      expect(
        await database.as(asUser(other), (query) =>
          query('select * from public.exam_marks_checks(null)'),
        ),
      ).toEqual([]);
    }
  });
});
