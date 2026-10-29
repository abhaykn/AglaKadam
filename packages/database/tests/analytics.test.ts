import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './support/database';
import { asUser, createScenario, insertStudent, type Scenario } from './support/scenario';

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

const service = { kind: 'service' } as const;
let section = 0;

async function newClass(schoolId: string, grade: number): Promise<string> {
  section += 1;
  const [row] = await database.query<{ id: string }>(
    `insert into public.class_sections (school_id, academic_year_id, grade, section)
     values ($1, $2, $3, $4) returning id`,
    [schoolId, scenario.academicYearId, grade, `S${String(section)}`],
  );
  return String(row?.id);
}

interface Check {
  reading: 'fluent' | 'hesitant' | 'needs_support';
  /** Scored by the engine on the passage at this speed. */
  wcpm?: number;
  /** Scored by the engine, who stepped down to words. */
  words?: boolean;
  student?: string | undefined;
}

/** One month's Pulse of a class: a recorded check per child, scored by the engine when a speed is given. */
async function pulse(
  classId: string,
  schoolId: string,
  grade: number,
  checks: Check[],
  monthsBack = 0,
): Promise<string[]> {
  const [cycle] = await database.query<{ id: string }>(
    `insert into public.pulse_cycles (class_section_id, month, grade, language, first_week,
       eligible_count, sample_size, reserve_size)
     values ($1, (date_trunc('month', private.today()) - make_interval(months => $2))::date, $3,
       'hi', 1, $4, $4, 0)
     returning id`,
    [classId, monthsBack, grade, checks.length],
  );
  const students: string[] = [];
  for (const [index, check] of checks.entries()) {
    const student =
      check.student ??
      (await insertStudent(database.query, {
        schoolId,
        fullName: `Reader ${String(index + 1)}`,
        classSectionId: classId,
      }));
    students.push(student);
    const [sample] = await database.query<{ id: string }>(
      `insert into public.pulse_samples (cycle_id, class_section_id, student_id, draw_position,
         week, opens_on, due_on, adapted)
       values ($1, $2, $3, $4, 1, private.today() - 3, private.today() + 3, false)
       returning id`,
      [cycle?.id, classId, student, index + 1],
    );
    const id = randomUUID();
    const path = `${classId}/${String(sample?.id)}/${id}.webm`;
    await database.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('pulse-audio', $1, $2, '{"size": 1000, "mimetype": "audio/webm"}')`,
      [path, scenario.staff.teacherA1],
    );
    await database.query(
      `insert into public.pulse_checks (id, sample_id, class_section_id, student_id, item_code,
         prompt_code, item, audio_path, audio_type, audio_bytes, duration_ms, reading_level,
         english_level, clarity, classroom, recorded_at, received_at)
       values ($1, $2, $3, $4, $7, $8, '{"shown": []}', $5, '', 0, 58000, $6,
         'words', 'clear', 'normal', now() - interval '1 day', now() - interval '1 day')`,
      [
        id,
        sample?.id,
        classId,
        student,
        path,
        check.reading,
        `hi-g${String(grade)}-p01`,
        `en-g${String(grade)}-s01`,
      ],
    );
    if (check.wcpm !== undefined || check.words) {
      await database.as(service, (query) =>
        query(
          `insert into public.pulse_scores (check_id, class_section_id, engine_version,
             reading_level, reached_level, reading_items, reading_correct, reading_seconds, wcpm,
             english_level, english_words, english_seconds, keyword_hits, other_language_share,
             confidence, flags)
           values ($1, $2, 'pulse-engine 1.0', $3, $5, 40, 38, 45, $4, 'words', 2, 10, 1,
             0, 0.9, '{}')`,
          [id, classId, check.reading, check.wcpm ?? null, check.words ? 'words' : 'passage'],
        ),
      );
    }
  }
  return students;
}

/** The 15th of last month: the office's report holds finished months only. */
async function lastMonthDay(): Promise<string> {
  const [row] = await database.query<{ day: string }>(
    `select (date_trunc('month', private.today()) - interval '1 month' + interval '14 days')::date::text
       as day`,
  );
  return String(row?.day);
}

/**
 * A visit last month, with feedback agreed 30 minutes after the last moment noted; scored 8 plus
 * `specific` when given, for the feedback as agreed.
 */
async function visit(
  classId: string,
  schoolId: string,
  options: {
    crp?: string;
    follows?: string;
    result?: 'practised' | 'partly' | 'not_yet' | undefined;
    specific?: number;
    moments?: boolean;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const day = await lastMonthDay();
  await database.query(
    `insert into public.visits (id, class_section_id, school_id, crp_id, status, visited_on,
       started_at, follows_visit_id, follow_up_result)
     values ($1, $2, $3, $4, 'done', $5::date, ($5 || 'T04:00:00Z')::timestamptz, $6, $7)`,
    [
      id,
      classId,
      schoolId,
      options.crp ?? scenario.staff.crpA,
      day,
      options.follows ?? null,
      options.result ?? null,
    ],
  );
  if (options.moments !== false) {
    await database.query(
      `insert into public.visit_moments (id, visit_id, tag_code, at_seconds)
       values ($1, $2, 'good-question', 1800)`,
      [randomUUID(), id],
    );
  }
  await database.query(
    `insert into public.visit_feedback (visit_id, strength, practice_code, check_back_on,
       agreed_at)
     values ($1, 'A strength', 'paired-reading', $2::date + 14, ($2 || 'T05:00:00Z')::timestamptz)`,
    [id, day],
  );
  if (options.specific !== undefined) {
    await database.query(
      `insert into public.visit_feedback_scores (visit_id, crp_id, specific, evidence, one_focus,
         demonstration, check_back, respectful, tip, model, feedback_agreed_at)
       values ($1, $2, $3, 2, 2, 2, 2, 0, 'Tip.', 'test-model', ($4 || 'T05:00:00Z')::timestamptz)`,
      [id, options.crp ?? scenario.staff.crpA, options.specific, day],
    );
  }
  return id;
}

function report(userId: string) {
  return database
    .as(asUser(userId), (query) =>
      query<{ report: Record<string, unknown> | null }>('select public.area_report(6) as report'),
    )
    .then(([row]) => row?.report ?? null);
}

/** The last finished month of the coaching figures. */
function lastCoaching(body: Record<string, unknown> | null): Record<string, unknown> | undefined {
  return (body?.coaching as Record<string, unknown>[]).at(-1);
}

/** The last month's Pulse row of a class and medium. */
function lastPulse(
  body: Record<string, unknown> | null,
  grade: number,
): Record<string, unknown> | undefined {
  return (body?.pulse as Record<string, unknown>[])
    .filter((row) => row.grade === grade && row.language === 'hi')
    .at(-1);
}

/** Five Class 2 classes over three schools of the north block, and who visits each. */
async function fiveClasses(): Promise<{ classId: string; school: string; crp: string }[]> {
  const places = [
    { school: scenario.schoolA1Id, crp: scenario.staff.crpA },
    { school: scenario.schoolA1Id, crp: scenario.staff.crpA },
    { school: scenario.schoolA2Id, crp: scenario.staff.crpA },
    { school: scenario.schoolA2Id, crp: scenario.staff.crpA },
    { school: scenario.schoolB1Id, crp: scenario.staff.crpB },
  ];
  const classes = [];
  for (const place of places) {
    classes.push({ ...place, classId: await newClass(place.school, 2) });
  }
  return classes;
}

describe("the office's report", () => {
  it('is only for offices and administrators, and holds finished months only', async () => {
    for (const user of [scenario.staff.teacherA1, scenario.staff.crpA, scenario.familyAccountId]) {
      expect(await report(user)).toBeNull();
    }
    const block = await report(scenario.staff.blockOfficer);
    expect(block).toMatchObject({ fewest_classes: 5, fewest_schools: 3, schools: 3 });
    const months = (block?.coaching as { month: string }[]).map((row) => row.month);
    expect(months).toHaveLength(6);
    expect(months.at(-1)).toBe(block?.last_month);
    expect(await report(scenario.staff.districtOfficer)).toMatchObject({ schools: 4 });
  });

  it('counts change in practice, feedback, time and reading against Lakshya', async () => {
    const results = ['practised', 'practised', 'practised', 'partly', 'not_yet'] as const;
    for (const [index, place] of (await fiveClasses()).entries()) {
      await pulse(
        place.classId,
        place.school,
        2,
        [
          { reading: 'fluent', wcpm: 40 + index * 5 },
          { reading: 'needs_support', words: true },
          { reading: 'hesitant' },
        ],
        1,
      );
      const first = await visit(place.classId, place.school, { crp: place.crp });
      await visit(place.classId, place.school, {
        crp: place.crp,
        follows: first,
        result: results[index],
        specific: index % 3,
      });
    }
    const block = await report(scenario.staff.blockOfficer);
    expect(lastPulse(block, 2)).toMatchObject({
      withheld: false,
      classes: 5,
      checked: 15,
      fluent: 5,
      needs_support: 5,
      hesitant: 5,
      independent: 10,
      // The ten timed readers: five read the passage (40 to 60 a minute), five stepped down to
      // words, read none of it and count with no words a minute, below the Lakshya. The middle of
      // the ten lies between 0 and 40.
      speed: { timed: 10, median_wcpm: 20, at_lakshya: 4, lakshya: 45 },
    });
    expect(lastCoaching(block)).toMatchObject({
      visits_done: { visits: 10, classes: 5 },
      follow_ups: { practised: 3, partly: 1, not_yet: 1 },
      feedback_score: { average: 8.8 },
      time_to_feedback: { median_minutes: 30 },
    });
    // No school, class or person appears anywhere in the report.
    const text = JSON.stringify(block);
    for (const id of [scenario.schoolA1Id, scenario.staff.crpA, scenario.staff.crpB]) {
      expect(text).not.toContain(id);
    }
  });

  it('withholds what fewer than five classes, three schools or two CRPs would show', async () => {
    // Four classes: nothing.
    const four = (await fiveClasses()).slice(0, 4);
    for (const place of four) {
      await pulse(place.classId, place.school, 2, [{ reading: 'fluent', wcpm: 50 }], 1);
      await visit(place.classId, place.school, { crp: place.crp, specific: 1 });
    }
    let block = await report(scenario.staff.blockOfficer);
    expect(lastPulse(block, 2)).toMatchObject({ withheld: true });
    expect(lastCoaching(block)).toMatchObject({
      visits_done: null,
      feedback_score: null,
      time_to_feedback: null,
    });

    // Five classes of one school: still nothing.
    for (let index = 0; index < 5; index += 1) {
      const classId = await newClass(scenario.schoolA1Id, 3);
      await pulse(classId, scenario.schoolA1Id, 3, [{ reading: 'fluent', wcpm: 70 }], 1);
    }
    block = await report(scenario.staff.blockOfficer);
    expect(lastPulse(block, 3)).toMatchObject({ withheld: true });
  });

  it("keeps one CRP's coaching and a few timed readers out of sight", async () => {
    for (const place of await fiveClasses()) {
      // Every class visited by one CRP; only two classes timed by the engine.
      await visit(place.classId, place.school, { crp: scenario.staff.crpA, specific: 2 });
      await pulse(
        place.classId,
        place.school,
        2,
        [
          place.school === scenario.schoolA1Id
            ? { reading: 'fluent', wcpm: 61 }
            : { reading: 'hesitant' },
        ],
        1,
      );
    }
    const block = await report(scenario.staff.blockOfficer);
    expect(lastCoaching(block)).toMatchObject({
      visits_done: null,
      feedback_score: null,
      time_to_feedback: null,
    });
    expect(lastPulse(block, 2)).toMatchObject({ withheld: false, checked: 5, speed: null });
  });

  it('times feedback only from a lesson with moments, and scores only feedback as agreed', async () => {
    for (const place of await fiveClasses()) {
      const id = await visit(place.classId, place.school, {
        crp: place.crp,
        specific: 2,
        moments: place.school !== scenario.schoolB1Id,
      });
      if (place.school === scenario.schoolA2Id) {
        // Agreed again after it was scored: that score is of an earlier version.
        await database.query(
          `update public.visit_feedback set agreed_at = agreed_at + interval '1 minute'
           where visit_id = $1`,
          [id],
        );
      }
    }
    const block = await report(scenario.staff.blockOfficer);
    // Without B1's untimed visit only two schools are left; without A2's stale scores, two.
    expect(lastCoaching(block)).toMatchObject({
      visits_done: { visits: 5, classes: 5 },
      feedback_score: null,
      time_to_feedback: null,
    });
  });
});

describe("a child's and a class's progress", () => {
  it('shows the school its children month by month, and nothing to another school', async () => {
    const [child] = await pulse(
      scenario.classA1Grade1Id,
      scenario.schoolA1Id,
      1,
      [{ reading: 'needs_support' }],
      1,
    );
    await pulse(scenario.classA1Grade1Id, scenario.schoolA1Id, 1, [
      { reading: 'fluent', wcpm: 38, student: child },
    ]);
    await database.query(
      `insert into public.attendance_sessions (class_section_id, attendance_date,
         absent_student_ids, enrolled_count)
       values ($1, private.today(), $2::uuid[], 0)`,
      [scenario.classA1Grade1Id, [child]],
    );
    const progress = (userId: string) =>
      database
        .as(asUser(userId), (query) =>
          query<{ progress: Record<string, unknown> | null }>(
            'select public.child_progress($1) as progress',
            [child],
          ),
        )
        .then(([row]) => row?.progress ?? null);
    const seen = await progress(scenario.staff.teacherA1);
    expect(seen?.pulse).toEqual([
      expect.objectContaining({ reading: 'needs_support', source: 'teacher', wcpm: null }),
      expect.objectContaining({ reading: 'fluent', source: 'engine', wcpm: 38 }),
    ]);
    expect(seen?.attendance).toEqual([expect.objectContaining({ marked: 1, present: 0 })]);
    expect(await progress(scenario.staff.crpA)).not.toBeNull();
    expect(await progress(scenario.staff.teacherB1)).toBeNull();
    expect(await progress(scenario.staff.blockOfficer)).toBeNull();

    const classView = (userId: string) =>
      database
        .as(asUser(userId), (query) =>
          query<{ progress: Record<string, unknown> | null }>(
            'select public.class_progress($1) as progress',
            [scenario.classA1Grade1Id],
          ),
        )
        .then(([row]) => row?.progress ?? null);
    const ofClass = await classView(scenario.staff.teacherA1);
    expect(ofClass?.months).toEqual([
      expect.objectContaining({ checked: 1, needs_support: 1 }),
      expect.objectContaining({ checked: 1, fluent: 1 }),
    ]);
    const children = ofClass?.children as Record<string, unknown>[];
    expect(children.find((entry) => entry.student_id === child)).toMatchObject({
      latest: 'fluent',
      previous: 'needs_support',
      wcpm: 38,
      days_marked: 1,
      days_present: 0,
    });
    expect(await classView(scenario.staff.teacherB1)).toBeNull();
  });
});
