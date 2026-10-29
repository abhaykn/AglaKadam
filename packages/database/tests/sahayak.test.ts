import { randomUUID } from 'node:crypto';
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

const service = { kind: 'service' } as const;
const PROJECT = '00000000-0000-0000-0000-000000000000';

function take(profileId: string, kind: string, limit: number) {
  return database
    .as(service, (query) =>
      query<{ taken: boolean }>('select public.service_take_ai_quota($1, $2, $3) as taken', [
        profileId,
        kind,
        limit,
      ]),
    )
    .then(([row]) => row?.taken);
}

/** A visit to class A1 Grade 1 by CRP A that took place today. */
async function doneVisit(): Promise<string> {
  const id = randomUUID();
  const [today] = await database.query<{ today: string }>('select private.today()::text as today');
  await database.as(asUser(scenario.staff.crpA), (query) =>
    query('select public.save_visit($1::jsonb)', [
      JSON.stringify({
        id,
        change_id: randomUUID(),
        class_section_id: scenario.classA1Grade1Id,
        status: 'done',
        visited_on: today?.today,
        planned_on: null,
        started_at: new Date().toISOString(),
        observations: [],
        moments: [],
        rechecks: [],
      }),
    ]),
  );
  return id;
}

describe('the daily allowance', () => {
  it('gives requests until the limit, separately per person and kind', async () => {
    const crp = scenario.staff.crpA;
    expect(await take(crp, 'draft', 2)).toBe(true);
    expect(await take(crp, 'draft', 2)).toBe(true);
    expect(await take(crp, 'draft', 2)).toBe(false);
    expect(await take(crp, 'rehearse', 2)).toBe(true);
    expect(await take(scenario.staff.crpB, 'draft', 2)).toBe(true);
    expect(await take(PROJECT, 'claude', 1)).toBe(true);
    expect(await take(PROJECT, 'claude', 1)).toBe(false);
    expect(await take(crp, 'order', 0)).toBe(false);

    // A request the service could not answer is given back.
    await database.as(service, (query) =>
      query('select public.service_return_ai_quota($1, $2)', [crp, 'draft']),
    );
    expect(await take(crp, 'draft', 2)).toBe(true);
    expect(await take(crp, 'draft', 2)).toBe(false);
  });

  it('is kept away from signed-in users, and old counts are removed', async () => {
    for (const sql of [
      `select public.service_take_ai_quota('${scenario.staff.crpA}', 'draft', 100)`,
      `select public.service_return_ai_quota('${scenario.staff.crpA}', 'draft')`,
      'select * from private.ai_usage',
    ]) {
      expect(
        await errorCodeOf(database.as(asUser(scenario.staff.crpA), (query) => query(sql))),
      ).toBe('42501');
    }
    await take(scenario.staff.crpA, 'draft', 5);
    await database.query(
      `insert into private.ai_usage (profile_id, used_on, kind, used)
       values ($1, private.today() - 91, 'draft', 3)`,
      [scenario.staff.crpA],
    );
    await database.query('select private.purge_ai_usage()');
    const rows = await database.query<{ used_on: string }>(
      'select used_on::text from private.ai_usage',
    );
    expect(rows).toHaveLength(1);
  });
});

describe('feedback scores and debriefs', () => {
  it('are read only by the CRP they belong to, and written only by the function', async () => {
    const visit = await doneVisit();
    const score = {
      visit_id: visit,
      crp_id: scenario.staff.crpA,
      specific: 2,
      evidence: 1,
      one_focus: 2,
      demonstration: 0,
      check_back: 2,
      respectful: 2,
      tip: 'Show the practice once in the class before you leave.',
      language: 'en',
      model: 'test-model',
      feedback_agreed_at: new Date().toISOString(),
    };
    const insertScore = (identity: Parameters<TestDatabase['as']>[0]) =>
      database.as(identity, (query) =>
        query<{ total: number }>(
          `insert into public.visit_feedback_scores
             (visit_id, crp_id, specific, evidence, one_focus, demonstration, check_back,
              respectful, tip, language, model, feedback_agreed_at)
           select (r ->> 'visit_id')::uuid, (r ->> 'crp_id')::uuid, (r ->> 'specific')::smallint,
             (r ->> 'evidence')::smallint, (r ->> 'one_focus')::smallint,
             (r ->> 'demonstration')::smallint, (r ->> 'check_back')::smallint,
             (r ->> 'respectful')::smallint, r ->> 'tip', r ->> 'language', r ->> 'model',
             (r ->> 'feedback_agreed_at')::timestamptz
           from (select $1::jsonb as r) as input
           returning total`,
          [JSON.stringify(score)],
        ),
      );
    expect(await errorCodeOf(insertScore(asUser(scenario.staff.crpA)))).toBe('42501');
    expect(await insertScore(service)).toEqual([{ total: 9 }]);
    expect(await errorCodeOf(insertScore(service).then(() => undefined))).toBe('23505');

    await database.as(service, (query) =>
      query(
        `insert into public.rehearsal_debriefs
           (crp_id, scenario, language, turns, named_practice, asked_constraints,
            agreed_check_back, kept_blame_out, cited_evidence, went_well, try_next, provider)
         values ($1, 'tired-veteran', 'hi', 8, true, true, false, true, false,
                 'You asked about her day first.', 'Agree a day to look again.', 'claude')`,
        [scenario.staff.crpA],
      ),
    );

    const read = (userId: string) =>
      database.as(asUser(userId), async (query) => ({
        scores: await query('select visit_id from public.visit_feedback_scores'),
        debriefs: await query('select id from public.rehearsal_debriefs'),
      }));
    const own = await read(scenario.staff.crpA);
    expect(own.scores).toHaveLength(1);
    expect(own.debriefs).toHaveLength(1);
    for (const other of [
      scenario.staff.crpB,
      scenario.staff.teacherA1,
      scenario.staff.blockOfficer,
      scenario.familyAccountId,
    ]) {
      expect(await read(other)).toEqual({ scores: [], debriefs: [] });
    }
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.crpA), (query) =>
          query('update public.visit_feedback_scores set specific = 2'),
        ),
      ),
    ).toBe('42501');
  });

  it('refuses parts outside the rubric, and goes with the visit', async () => {
    const visit = await doneVisit();
    const insert = (specific: number) =>
      database.as(owner, (query) =>
        query(
          `insert into public.visit_feedback_scores
           (visit_id, crp_id, specific, evidence, one_focus, demonstration, check_back,
            respectful, tip, model, feedback_agreed_at)
         values ($1, $2, $3, 0, 0, 0, 0, 0, 'Tip.', 'test-model', now())`,
          [visit, scenario.staff.crpA, specific],
        ),
      );
    expect(await errorCodeOf(insert(3))).toBe('23514');
    // The fingerprint of the scored feedback is a SHA-256 in hexadecimal, or not yet known.
    expect(
      await errorCodeOf(
        database.as(owner, (query) =>
          query(
            `insert into public.visit_feedback_scores
               (visit_id, crp_id, specific, evidence, one_focus, demonstration, check_back,
                respectful, tip, model, feedback_agreed_at, feedback_fingerprint)
             values ($1, $2, 1, 0, 0, 0, 0, 0, 'Tip.', 'test-model', now(), 'not-a-hash')`,
            [visit, scenario.staff.crpA],
          ),
        ),
      ),
    ).toBe('23514');
    await insert(1);
    await database.query('delete from public.visits where id = $1', [visit]);
    expect(await database.query('select * from public.visit_feedback_scores')).toEqual([]);
  });
});
