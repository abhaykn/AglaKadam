import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, type TestDatabase } from './support/database';
import {
  asUser,
  createScenario,
  insertStudent,
  provisionStaff,
  type Scenario,
} from './support/scenario';

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

type Payload = Record<string, unknown>;

/** A visit to class A1 Grade 1 that is taking place today. */
function doneVisit(overrides: Payload = {}): Payload {
  return {
    id: randomUUID(),
    class_section_id: scenario.classA1Grade1Id,
    teacher_id: scenario.staff.teacherA1,
    status: 'done',
    visited_on: today(),
    started_at: new Date(Date.now() - 45 * 60_000).toISOString(),
    finished_at: new Date().toISOString(),
    lesson_note: 'Sarangi, lesson 6, page 41',
    observations: [
      { item_code: 'every-child-reads', position: 1, answer: 'yes' },
      { item_code: 'bottom-group-turns', position: 2, answer: 'no', note: 'Back rows waited.' },
    ],
    moments: [],
    rechecks: [],
    ...overrides,
  };
}

function today(offsetDays = 0): string {
  const india = new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000);
  return india.toISOString().slice(0, 10);
}

/** Saves a visit as a device does; every save carries a new change identifier unless given one. */
function saveVisit(userId: string, payload: Payload) {
  return database.as(asUser(userId), (query) =>
    query<{ revision: number }>('select public.save_visit($1::jsonb) as revision', [
      JSON.stringify({ change_id: randomUUID(), ...payload }),
    ]),
  );
}

async function saved(userId: string, payload: Payload): Promise<number> {
  const [row] = await saveVisit(userId, payload);
  return Number(row?.revision);
}

function visibleVisitIds(userId: string) {
  return database
    .as(asUser(userId), (query) => query<{ id: string }>('select id from public.visits'))
    .then((rows) => rows.map((row) => row.id));
}

let pulseMonthsBack = 0;

/** A Pulse cycle of class A1 Grade 1 with one recorded check per given level pair. */
async function pulseChecks(
  levels: { reading: string; english: string }[],
  monthsBack = 0,
): Promise<string[]> {
  pulseMonthsBack += 1;
  const [cycle] = await database.query<{ id: string }>(
    `insert into public.pulse_cycles (class_section_id, month, grade, language,
       first_week, eligible_count, sample_size, reserve_size)
     values ($1, (date_trunc('month', private.today()) - make_interval(months => $2))::date, 1,
       'hi', 1, $3, $3, 0)
     on conflict (class_section_id, month) do update set sample_size = excluded.sample_size
     returning id`,
    [scenario.classA1Grade1Id, monthsBack, levels.length],
  );
  const ids: string[] = [];
  for (const [index, level] of levels.entries()) {
    const student = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: `Child ${pulseMonthsBack}-${index + 1}`,
      classSectionId: scenario.classA1Grade1Id,
    });
    const [sample] = await database.query<{ id: string }>(
      `insert into public.pulse_samples (cycle_id, class_section_id, student_id, draw_position,
         week, opens_on, due_on, adapted)
       values ($1, $2, $3, $4, 1, private.today() - 3, private.today() + 3, false)
       returning id`,
      [cycle?.id, scenario.classA1Grade1Id, student, index + 1],
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
         $7, 'clear', 'normal', now() - interval '1 day', now() - interval '1 day')`,
      [id, sample?.id, scenario.classA1Grade1Id, student, path, level.reading, level.english],
    );
    ids.push(id);
  }
  return ids;
}

function machineScore(checkId: string, reading: string, english: string, flags: string[] = []) {
  return database.as(service, (query) =>
    query(
      `insert into public.pulse_scores (check_id, class_section_id, engine_version, reading_level,
         reached_level, reading_items, reading_correct, reading_seconds, wcpm, english_level,
         english_words, english_seconds, keyword_hits, other_language_share, confidence, flags)
       values ($1, $2, 'pulse-engine 1.0', $3, 'words', 10, 6, 20, null, $4, 2, 10, 1, 0, 0.8,
         $5)`,
      [checkId, scenario.classA1Grade1Id, reading, english, flags],
    ),
  );
}

describe('visits', () => {
  it('lets the CRP plan a visit, carry it out and keep its version', async () => {
    const id = randomUUID();
    const planned = await saved(scenario.staff.crpA, {
      id,
      class_section_id: scenario.classA1Grade1Id,
      status: 'planned',
      planned_on: today(2),
    });
    const [row] = await database.query<{ crp_id: string; school_id: string }>(
      'select crp_id, school_id from public.visits where id = $1',
      [id],
    );
    expect(row).toEqual({ crp_id: scenario.staff.crpA, school_id: scenario.schoolA1Id });
    const after = () =>
      database.query<{ status: string; lesson_note: string | null }>(
        'select status, lesson_note from public.visits where id = $1',
        [id],
      );
    expect(await after()).toEqual([{ status: 'planned', lesson_note: null }]);

    expect(planned).toBe(1);
    const done = await saved(scenario.staff.crpA, doneVisit({ id, base_revision: planned }));
    expect(done).toBe(2);
    expect(await after()).toEqual([{ status: 'done', lesson_note: 'Sarangi, lesson 6, page 41' }]);
    const observations = await database.query(
      'select item_code, position, answer, note from public.visit_observations where visit_id = $1 order by position',
      [id],
    );
    expect(observations).toEqual([
      { item_code: 'every-child-reads', position: 1, answer: 'yes', note: null },
      { item_code: 'bottom-group-turns', position: 2, answer: 'no', note: 'Back rows waited.' },
    ]);
  });

  it('refuses to overwrite a visit changed on another device', async () => {
    const visit = doneVisit();
    const first = await saved(scenario.staff.crpA, visit);
    await saved(scenario.staff.crpA, { ...visit, base_revision: first, observations: [] });
    expect(
      await errorCodeOf(saveVisit(scenario.staff.crpA, { ...visit, base_revision: first })),
    ).toBe('40001');
    expect(await errorCodeOf(saveVisit(scenario.staff.crpA, visit))).toBe('40001');
  });

  it("applies a resent save once, and builds on the device's own earlier save", async () => {
    const visit = doneVisit();
    const first = randomUUID();
    expect(await saved(scenario.staff.crpA, { ...visit, change_id: first })).toBe(1);
    // The answer was lost and the same save arrives again: nothing changes.
    expect(await saved(scenario.staff.crpA, { ...visit, change_id: first, observations: [] })).toBe(
      1,
    );
    const [count] = await database.query<{ items: number }>(
      'select count(*)::integer as items from public.visit_observations where visit_id = $1',
      [visit.id],
    );
    expect(count?.items).toBe(2);

    // The CRP changed the visit again before the first answer came back: the second save still
    // starts from no revision, but the server's visit is the device's own earlier save.
    expect(
      await saved(scenario.staff.crpA, {
        ...visit,
        supersedes: [first],
        observations: [{ item_code: 'every-child-reads', position: 1, answer: 'no' }],
      }),
    ).toBe(2);
    // Another device's save is never taken for one's own.
    expect(
      await errorCodeOf(
        saveVisit(scenario.staff.crpA, { ...visit, base_revision: 1, supersedes: [first] }),
      ),
    ).toBe('40001');
  });

  it("keeps visits within the CRP's own cluster", async () => {
    expect(await errorCodeOf(saveVisit(scenario.staff.crpB, doneVisit()))).toBe('42501');
    expect(await errorCodeOf(saveVisit(scenario.staff.teacherA1, doneVisit()))).toBe('42501');
    expect(await errorCodeOf(saveVisit(scenario.staff.blockOfficer, doneVisit()))).toBe('42501');
  });

  it('refuses visits in the future or older than two weeks', async () => {
    expect(
      await errorCodeOf(saveVisit(scenario.staff.crpA, doneVisit({ visited_on: today(1) }))),
    ).toBe('23514');
    expect(
      await errorCodeOf(saveVisit(scenario.staff.crpA, doneVisit({ visited_on: today(-15) }))),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        saveVisit(scenario.staff.crpA, {
          id: randomUUID(),
          class_section_id: scenario.classA1Grade1Id,
          status: 'planned',
          planned_on: today(90),
        }),
      ),
    ).toBe('23514');
  });

  it('lets only the CRP who made a visit change it, and only for 14 days', async () => {
    const visit = doneVisit();
    const version = await saved(scenario.staff.crpA, visit);
    // A second CRP of the cluster reads the visit but cannot change it.
    const crpA2 = await provisionStaff(database.query, {
      fullName: 'CRP A2',
      role: 'crp',
      scopeId: scenario.clusterAId,
    });
    expect(await visibleVisitIds(crpA2)).toEqual([visit.id]);
    expect(await errorCodeOf(saveVisit(crpA2, { ...visit, base_revision: version }))).toBe('42501');

    // A visit more than 14 days old is closed.
    await database.query(
      `update public.visits set visited_on = private.today() - 20, started_at = now() - interval '20 days',
         finished_at = null where id = $1`,
      [visit.id],
    );
    expect(
      await errorCodeOf(saveVisit(scenario.staff.crpA, { ...visit, base_revision: version })),
    ).toBe('42501');
  });

  it('answers a resent save again once the visit has closed', async () => {
    const visit = doneVisit();
    const change = randomUUID();
    expect(await saved(scenario.staff.crpA, { ...visit, change_id: change })).toBe(1);
    await database.query(
      `update public.visits set visited_on = private.today() - 20, started_at = now() - interval '20 days',
         finished_at = null where id = $1`,
      [visit.id],
    );
    expect(await saved(scenario.staff.crpA, { ...visit, change_id: change })).toBe(1);
  });

  it('counts the 14 days from when the visit was first recorded, if that is earlier', async () => {
    const visit = doneVisit({
      visited_on: today(-2),
      started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      finished_at: null,
    });
    const version = await saved(scenario.staff.crpA, visit);
    const [row] = await database.query<{ recorded: boolean }>(
      'select done_at = now() as recorded from public.visits where id = $1',
      [visit.id],
    );
    expect(row?.recorded).toBe(true);
    // A visit that took place keeps its date or moves earlier, never later.
    expect(
      await errorCodeOf(
        saveVisit(scenario.staff.crpA, { ...visit, base_revision: version, visited_on: today(-1) }),
      ),
    ).toBe('23514');
    // Recorded 15 days ago: closed, whatever its date says.
    await database.query(
      `update public.visits set done_at = now() - interval '15 days' where id = $1`,
      [visit.id],
    );
    expect(
      await errorCodeOf(saveVisit(scenario.staff.crpA, { ...visit, base_revision: version })),
    ).toBe('42501');
  });

  it('keeps the start of a visit on its day', async () => {
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ started_at: new Date(Date.now() - 4 * 86_400_000).toISOString() }),
        ),
      ),
    ).toBe('23514');
  });

  it('writes a visit and its parts only through save_visit', async () => {
    const visit = doneVisit();
    await saved(scenario.staff.crpA, visit);
    const direct = (sql: string) =>
      errorCodeOf(database.as(asUser(scenario.staff.crpA), (query) => query(sql, [visit.id])));
    expect(
      await direct(
        `insert into public.visit_observations (visit_id, item_code, position, answer)
         values ($1, 'questions-for-thinking', 3, 'yes')`,
      ),
    ).toBe('42501');
    expect(
      await direct(`update public.visit_observations set answer = 'yes' where visit_id = $1`),
    ).toBe('42501');
    expect(await direct('delete from public.visit_observations where visit_id = $1')).toBe('42501');
    expect(
      await direct(
        `insert into public.visit_moments (id, visit_id, tag_code, at_seconds)
         values (gen_random_uuid(), $1, 'good-question', 10)`,
      ),
    ).toBe('42501');
    expect(
      await direct(`update public.visits set lesson_note = 'Changed directly' where id = $1`),
    ).toBe('42501');
    expect(
      await direct(
        `insert into public.visits (id, class_section_id, status, planned_on)
         values (gen_random_uuid(), (select class_section_id from public.visits where id = $1),
           'planned', private.today() + 1)`,
      ),
    ).toBe('42501');
  });

  it('keeps the agreed feedback while the device sends the visit without it', async () => {
    const moment = randomUUID();
    const visit = doneVisit({
      moments: [{ id: moment, tag_code: 'all-reading', at_seconds: 300 }],
      feedback: {
        strength: 'Every child read the line aloud in turn.',
        evidence: [{ moment }, { item: 'every-child-reads' }],
        practice_code: 'paired-reading',
        check_back_on: today(14),
        agreed_at: new Date().toISOString(),
      },
    });
    const first = await saved(scenario.staff.crpA, visit);
    // A save without the feedback key, as a device sends while its feedback is being redrafted.
    await saved(scenario.staff.crpA, {
      ...visit,
      feedback: undefined,
      base_revision: first,
      moments: [],
    });
    const [row] = await database.query<{ strength: string; evidence: unknown }>(
      'select strength, evidence from public.visit_feedback where visit_id = $1',
      [visit.id],
    );
    expect(row).toEqual({
      strength: 'Every child read the line aloud in turn.',
      evidence: [{ item: 'every-child-reads' }],
    });
    // An explicit null removes it.
    await saved(scenario.staff.crpA, { ...visit, base_revision: first + 1, feedback: null });
    expect(
      await database.query('select 1 from public.visit_feedback where visit_id = $1', [visit.id]),
    ).toEqual([]);
  });

  it('refuses an agreement dated before the visit', async () => {
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({
            feedback: {
              strength: 'Clear instructions.',
              practice_code: 'paired-reading',
              check_back_on: today(14),
              agreed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
            },
          }),
        ),
      ),
    ).toBe('23514');
  });

  it('shows a visit to the observed teacher, or to the class teachers when no one was observed', async () => {
    const planned = randomUUID();
    await saved(scenario.staff.crpA, {
      id: planned,
      class_section_id: scenario.classA1Grade1Id,
      status: 'planned',
      planned_on: today(1),
    });
    const done = doneVisit({ teacher_id: scenario.staff.teacherA1Colleague });
    await saved(scenario.staff.crpA, done);
    const unobserved = doneVisit({ teacher_id: null });
    await saved(scenario.staff.crpA, unobserved);

    expect((await visibleVisitIds(scenario.staff.crpA)).sort()).toEqual(
      [planned, done.id as string, unobserved.id as string].sort(),
    );
    // The colleague who was observed sees their visit, not the plan; the class teacher does not
    // read a colleague's coaching, only the visit in which no one was observed.
    expect(await visibleVisitIds(scenario.staff.teacherA1)).toEqual([unobserved.id]);
    expect(await visibleVisitIds(scenario.staff.teacherA1Colleague)).toEqual([done.id]);
    expect(await visibleVisitIds(scenario.staff.teacherA2)).toEqual([]);
    expect(await visibleVisitIds(scenario.staff.teacherB1)).toEqual([]);
    expect(await visibleVisitIds(scenario.staff.crpB)).toEqual([]);
    expect(await visibleVisitIds(scenario.staff.blockOfficer)).toEqual([]);
    expect(await visibleVisitIds(scenario.staff.districtOfficer)).toEqual([]);

    const observations = await database.as(asUser(scenario.staff.teacherA1Colleague), (query) =>
      query('select item_code from public.visit_observations where visit_id = $1', [done.id]),
    );
    expect(observations).toHaveLength(2);
    for (const teacher of [scenario.staff.teacherA1, scenario.staff.teacherA2]) {
      const hidden = await database.as(asUser(teacher), (query) =>
        query('select item_code from public.visit_observations where visit_id = $1', [done.id]),
      );
      expect(hidden).toEqual([]);
    }
  });

  it('only accepts a teacher of the school as the observed teacher', async () => {
    expect(
      await errorCodeOf(
        saveVisit(scenario.staff.crpA, doneVisit({ teacher_id: scenario.staff.teacherA2 })),
      ),
    ).toBe('23514');
  });

  it('lets the CRP drop a planned visit but not one that took place', async () => {
    const planned = randomUUID();
    await saved(scenario.staff.crpA, {
      id: planned,
      class_section_id: scenario.classA1Grade1Id,
      status: 'planned',
      planned_on: today(1),
      observations: [{ item_code: 'every-child-reads', position: 1, answer: null }],
    });
    const done = doneVisit();
    await saved(scenario.staff.crpA, done);
    const removed = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ id: string }>('delete from public.visits returning id'),
    );
    expect(removed).toEqual([{ id: planned }]);
    expect(
      await database.query('select 1 from public.visit_observations where visit_id = $1', [
        planned,
      ]),
    ).toEqual([]);
  });

  it('does not take a visit back to planned', async () => {
    const visit = doneVisit();
    const version = await saved(scenario.staff.crpA, visit);
    expect(
      await errorCodeOf(
        saveVisit(scenario.staff.crpA, {
          ...visit,
          base_revision: version,
          status: 'planned',
          planned_on: today(1),
          visited_on: null,
          started_at: null,
          finished_at: null,
        }),
      ),
    ).toBe('23514');
  });
});

describe('what a visit holds', () => {
  it('keeps at most five focus items and 60 moments', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      item_code: `item-${index + 1}`,
      position: index + 1,
      answer: 'yes',
    }));
    expect(
      await errorCodeOf(saveVisit(scenario.staff.crpA, doneVisit({ observations: items }))),
    ).toBe('23514');

    const moments = Array.from({ length: 61 }, (_, index) => ({
      id: randomUUID(),
      tag_code: 'good-question',
      at_seconds: index * 10,
    }));
    expect(await errorCodeOf(saveVisit(scenario.staff.crpA, doneVisit({ moments })))).toBe('23514');
    await saved(scenario.staff.crpA, doneVisit({ moments: moments.slice(0, 60) }));
  });

  it('re-checks at most two children of the visited class', async () => {
    const [first, second, third] = await pulseChecks([
      { reading: 'fluent', english: 'words' },
      { reading: 'hesitant', english: 'words' },
      { reading: 'needs_support', english: 'no_response' },
    ]);
    const recheck = (checkId: string | undefined) => ({
      check_id: checkId,
      reading_level: 'hesitant',
      english_level: 'words',
    });
    await saved(scenario.staff.crpA, doneVisit({ rechecks: [recheck(first), recheck(second)] }));
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ rechecks: [recheck(first), recheck(second), recheck(third)] }),
        ),
      ),
    ).toBe('23514');
    // A check of another class is refused.
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ class_section_id: scenario.classA1Grade2Id, rechecks: [recheck(first)] }),
        ),
      ),
    ).toBe('23514');
  });

  it('ties the feedback to evidence from the same visit and a check-back in range', async () => {
    const moment = randomUUID();
    const feedback = {
      strength: 'Every child read the line aloud in turn.',
      evidence: [{ moment }, { item: 'every-child-reads' }],
      practice_code: 'paired-reading',
      technique: 'Pair a stronger reader with a weaker one for five minutes daily.',
      demo_given: true,
      check_back_on: today(14),
      language: 'en',
      agreed_at: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const visit = doneVisit({
      moments: [{ id: moment, tag_code: 'all-reading', at_seconds: 300 }],
      feedback,
    });
    await saved(scenario.staff.crpA, visit);
    const [row] = await database.query<{ agreed_in_future: boolean; evidence: unknown }>(
      `select agreed_at > now() as agreed_in_future, evidence from public.visit_feedback
       where visit_id = $1`,
      [visit.id],
    );
    expect(row?.agreed_in_future).toBe(false);
    expect(row?.evidence).toEqual([{ moment }, { item: 'every-child-reads' }]);

    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ feedback: { ...feedback, evidence: [{ moment: randomUUID() }] } }),
        ),
      ),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ feedback: { ...feedback, evidence: [{ item: 'not-observed' }] } }),
        ),
      ),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ feedback: { ...feedback, evidence: [{ moment, item: 'x' }] } }),
        ),
      ),
    ).toBe('22023');
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ feedback: { ...feedback, evidence: [], check_back_on: today(1) } }),
        ),
      ),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({ feedback: { ...feedback, evidence: [], check_back_on: today(60) } }),
        ),
      ),
    ).toBe('23514');
  });

  it('follows up a step agreed at an earlier visit to the same class', async () => {
    const earlier = doneVisit({
      visited_on: today(-10),
      started_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      finished_at: null,
      feedback: {
        strength: 'Clear instructions.',
        practice_code: 'paired-reading',
        check_back_on: today(4),
        agreed_at: new Date().toISOString(),
      },
    });
    await saved(scenario.staff.crpA, earlier);
    await saved(
      scenario.staff.crpA,
      doneVisit({ follows_visit_id: earlier.id, follow_up_result: 'partly' }),
    );
    expect(
      await errorCodeOf(
        saveVisit(
          scenario.staff.crpA,
          doneVisit({
            class_section_id: scenario.classA1Grade2Id,
            teacher_id: null,
            follows_visit_id: earlier.id,
            follow_up_result: 'practised',
          }),
        ),
      ),
    ).toBe('23514');
    expect(
      await errorCodeOf(
        saveVisit(scenario.staff.crpA, {
          id: randomUUID(),
          class_section_id: scenario.classA1Grade1Id,
          status: 'planned',
          planned_on: today(1),
          follows_visit_id: earlier.id,
          follow_up_result: 'practised',
        }),
      ),
    ).toBe('23514');
  });
});

describe('visit requests', () => {
  function request(userId: string, classSectionId = scenario.classA1Grade1Id) {
    return database.as(asUser(userId), (query) =>
      query<{ id: string; requested_by: string; school_id: string }>(
        `insert into public.visit_requests (class_section_id, topic, note)
         values ($1, 'reading', 'Half the class cannot blend sounds yet.')
         returning id, requested_by, school_id`,
        [classSectionId],
      ),
    );
  }

  it('lets a teacher ask for one visit at a time, which a visit then answers', async () => {
    const [row] = await request(scenario.staff.teacherA1);
    expect(row).toMatchObject({
      requested_by: scenario.staff.teacherA1,
      school_id: scenario.schoolA1Id,
    });
    expect(await errorCodeOf(request(scenario.staff.teacherA1))).toBe('23505');
    // A colleague who does not teach the class cannot ask on its behalf, but may ask for a class
    // of the school that has no teacher yet.
    expect(await errorCodeOf(request(scenario.staff.teacherA1Colleague))).toBe('42501');
    await request(scenario.staff.teacherA1Colleague, scenario.classA1Grade2Id);
    expect(await errorCodeOf(request(scenario.staff.teacherB1))).toBe('42501');
    expect(await errorCodeOf(request(scenario.staff.crpA))).toBe('42501');

    const crpSees = await database.as(asUser(scenario.staff.crpA), (query) =>
      query('select id from public.visit_requests where class_section_id = $1', [
        scenario.classA1Grade1Id,
      ]),
    );
    expect(crpSees).toEqual([{ id: row?.id }]);
    const colleagueSees = await database.as(asUser(scenario.staff.teacherA1Colleague), (query) =>
      query('select id from public.visit_requests where class_section_id = $1', [
        scenario.classA1Grade1Id,
      ]),
    );
    expect(colleagueSees).toEqual([]);

    const visit = doneVisit();
    await saved(scenario.staff.crpA, visit);
    const [answered] = await database.query<{ answered_by_visit_id: string }>(
      'select answered_by_visit_id from public.visit_requests where id = $1',
      [row?.id],
    );
    expect(answered?.answered_by_visit_id).toBe(visit.id);
    // A new request can follow.
    await request(scenario.staff.teacherA1);
  });

  it('does not let a visit sent late answer a request made after it', async () => {
    const [row] = await request(scenario.staff.teacherA1);
    const late = doneVisit({
      visited_on: today(-3),
      started_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      finished_at: new Date(Date.now() - 3 * 86_400_000 + 45 * 60_000).toISOString(),
    });
    await saved(scenario.staff.crpA, late);
    const answeredBy = async () =>
      (
        await database.query<{ answered_by_visit_id: string | null }>(
          'select answered_by_visit_id from public.visit_requests where id = $1',
          [row?.id],
        )
      )[0]?.answered_by_visit_id;
    expect(await answeredBy()).toBeNull();
    // A late visit that names the request does answer it.
    const named = doneVisit({
      visited_on: today(-1),
      started_at: new Date(Date.now() - 86_400_000).toISOString(),
      finished_at: null,
      request_id: row?.id,
    });
    await saved(scenario.staff.crpA, named);
    expect(await answeredBy()).toBe(named.id);
  });

  it('lets the teacher who asked, or the class teacher, withdraw a request, and nothing else', async () => {
    const [row] = await request(scenario.staff.teacherA1);
    const withdraw = (userId: string, set = 'withdrawn_at = now()') =>
      database.as(asUser(userId), (query) =>
        query<{ id: string }>(
          `update public.visit_requests set ${set} where id = $1 returning id`,
          [row?.id],
        ),
      );
    expect(await withdraw(scenario.staff.crpA)).toEqual([]);
    expect(await withdraw(scenario.staff.teacherA1Colleague)).toEqual([]);
    expect(await errorCodeOf(withdraw(scenario.staff.teacherA1, "topic = 'english'"))).toBe(
      '42501',
    );
    expect(await withdraw(scenario.staff.teacherA1)).toEqual([{ id: row?.id }]);
    expect(await errorCodeOf(withdraw(scenario.staff.teacherA1))).toBe('42501');
  });
});

describe('reviews of Pulse recordings', () => {
  function review(userId: string, checkId: string | undefined, level = 'needs_support') {
    return database.as(asUser(userId), (query) =>
      query<{ class_section_id: string; reviewed_by: string }>(
        `insert into public.pulse_reviews (check_id, class_section_id, reading_level, english_level)
         values ($1, $2, $3, 'words')
         on conflict (check_id) do update set reading_level = excluded.reading_level
         returning class_section_id, reviewed_by`,
        [checkId, scenario.classA1Grade2Id, level],
      ),
    );
  }

  it('lets the CRP record their own levels, which the school can read', async () => {
    const [checkId] = await pulseChecks([{ reading: 'fluent', english: 'words' }]);
    const [row] = await review(scenario.staff.crpA, checkId);
    // The class is taken from the check, not from what was sent.
    expect(row).toEqual({
      class_section_id: scenario.classA1Grade1Id,
      reviewed_by: scenario.staff.crpA,
    });
    await review(scenario.staff.crpA, checkId, 'hesitant');
    const teacherSees = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select reading_level from public.pulse_reviews'),
    );
    expect(teacherSees).toEqual([{ reading_level: 'hesitant' }]);
    // The teacher reads the review but cannot change it: no row is reached.
    const changed = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `update public.pulse_reviews set reading_level = 'fluent' where check_id = $1
         returning check_id`,
        [checkId],
      ),
    );
    expect(changed).toEqual([]);
    const [kept] = await database.query<{ reading_level: string }>(
      'select reading_level from public.pulse_reviews where check_id = $1',
      [checkId],
    );
    expect(kept?.reading_level).toBe('hesitant');

    expect(await errorCodeOf(review(scenario.staff.teacherA1, checkId))).toBe('42501');
    expect(await errorCodeOf(review(scenario.staff.crpB, checkId))).toBe('42501');
  });
});

describe('CRP tasks', () => {
  function addTask(userId: string, values: Payload = {}) {
    return database.as(asUser(userId), (query) =>
      query<{ id: string; created_by: string }>(
        `insert into public.crp_tasks (id, cluster_id, school_id, title, source, due_on)
         values ($1, $2, $3, $4, 'order', private.today() + 3)
         returning id, created_by`,
        [
          values.id ?? randomUUID(),
          values.cluster_id ?? scenario.clusterAId,
          values.school_id ?? null,
          values.title ?? 'Send the enrolment figures to the block office',
        ],
      ),
    );
  }

  it('shares the tasks among the CRPs of the cluster only', async () => {
    const [task] = await addTask(scenario.staff.crpA, { school_id: scenario.schoolA2Id });
    expect(task?.created_by).toBe(scenario.staff.crpA);
    expect(await errorCodeOf(addTask(scenario.staff.crpB))).toBe('42501');
    expect(await errorCodeOf(addTask(scenario.staff.teacherA1))).toBe('42501');
    expect(
      await errorCodeOf(addTask(scenario.staff.crpA, { school_id: scenario.schoolB1Id })),
    ).toBe('23514');
    const crpBSees = await database.as(asUser(scenario.staff.crpB), (query) =>
      query('select id from public.crp_tasks'),
    );
    expect(crpBSees).toEqual([]);
    const done = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ in_future: boolean }>(
        `update public.crp_tasks set done_at = now() + interval '1 day' where id = $1
         returning done_at > now() as in_future`,
        [task?.id],
      ),
    );
    expect(done).toEqual([{ in_future: false }]);
  });
});

describe('the cluster signal', () => {
  function signal(userId: string) {
    return database.as(asUser(userId), (query) => query('select * from public.crp_class_signal()'));
  }

  it("summarises each current class of the CRP's schools for planning", async () => {
    const [fluentCheck, unsureCheck, disagreedCheck, ...rest] = await pulseChecks([
      { reading: 'fluent', english: 'words' },
      { reading: 'hesitant', english: 'words' },
      { reading: 'fluent', english: 'sentences' },
      { reading: 'needs_support', english: 'no_response' },
      { reading: 'needs_support', english: 'words' },
    ]);
    expect(rest).toHaveLength(2);
    await machineScore(String(fluentCheck), 'fluent', 'words');
    await machineScore(String(unsureCheck), 'hesitant', 'words', ['low_confidence']);
    await machineScore(String(disagreedCheck), 'hesitant', 'sentences');
    // The CRP listened to one and judged it lower: it then counts by the CRP's level.
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query(
        `insert into public.pulse_reviews (check_id, class_section_id, reading_level, english_level)
         values ($1, $2, 'needs_support', 'words')`,
        [unsureCheck, scenario.classA1Grade1Id],
      ),
    );

    const earlier = doneVisit({
      visited_on: today(-6),
      started_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      finished_at: null,
      feedback: {
        strength: 'Children answered in full sentences.',
        practice_code: 'paired-reading',
        check_back_on: today(8),
        agreed_at: new Date().toISOString(),
      },
    });
    await saved(scenario.staff.crpA, earlier);
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(`insert into public.visit_requests (class_section_id, topic) values ($1, 'english')`, [
        scenario.classA1Grade2Id,
      ]),
    );

    const rows = await signal(scenario.staff.crpA);
    expect(rows.map((row) => row.class_section_id).sort()).toEqual(
      [scenario.classA1Grade1Id, scenario.classA1Grade2Id].sort(),
    );
    const grade1 = rows.find((row) => row.class_section_id === scenario.classA1Grade1Id);
    expect(grade1).toMatchObject({
      school_id: scenario.schoolA1Id,
      grade: 1,
      pulse_checked: 5,
      needs_support: 3,
      hesitant: 0,
      fluent: 2,
      english_no_response: 1,
      // The disagreement only: the unsure recording was reviewed.
      to_listen: 1,
      last_visit_on: new Date(today(-6)),
      visits_this_year: 1,
      check_back_on: new Date(today(8)),
      check_back_visit_id: earlier.id,
      request_topic: null,
    });
    const grade2 = rows.find((row) => row.class_section_id === scenario.classA1Grade2Id);
    expect(grade2).toMatchObject({
      pulse_month: null,
      pulse_checked: 0,
      last_visit_on: null,
      request_topic: 'english',
    });

    // A follow-up visit closes the check-back.
    await saved(
      scenario.staff.crpA,
      doneVisit({ follows_visit_id: earlier.id, follow_up_result: 'practised' }),
    );
    const after = await signal(scenario.staff.crpA);
    expect(
      after.find((row) => row.class_section_id === scenario.classA1Grade1Id)?.check_back_on,
    ).toBeNull();

    // Each CRP sees the classes of their own cluster only; teachers none.
    const clusterB = await signal(scenario.staff.crpB);
    expect(clusterB.map((row) => row.class_section_id)).toEqual([scenario.classB1Grade1Id]);
    expect(clusterB[0]).toMatchObject({ pulse_checked: 0, to_listen: 0, last_visit_on: null });
    expect(await signal(scenario.staff.teacherA1)).toEqual([]);
  });

  it("uses last month's Pulse while this month has fewer than five children checked", async () => {
    const [lastMonth] = await pulseChecks(
      [
        { reading: 'needs_support', english: 'words' },
        { reading: 'needs_support', english: 'words' },
      ],
      1,
    );
    const [thisMonth] = await pulseChecks([{ reading: 'fluent', english: 'words' }], 0);
    await machineScore(String(lastMonth), 'hesitant', 'words');
    await machineScore(String(thisMonth), 'hesitant', 'words');
    const rows = await signal(scenario.staff.crpA);
    const grade1 = rows.find((row) => row.class_section_id === scenario.classA1Grade1Id);
    // Recordings to listen to are counted in both months.
    expect(grade1).toMatchObject({ pulse_checked: 2, needs_support: 2, to_listen: 2 });
  });
});
