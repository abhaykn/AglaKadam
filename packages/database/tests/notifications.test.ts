import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, type TestDatabase } from './support/database';
import { asUser, createScenario, provisionStaff, type Scenario } from './support/scenario';

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
const P256DH = `B${'x'.repeat(86)}`;
const AUTH = 'a'.repeat(22);

function keep(userId: string, endpoint: string) {
  return database.as(asUser(userId), (query) =>
    query('select public.keep_push_subscription($1, $2, $3)', [endpoint, P256DH, AUTH]),
  );
}

function ownSubscriptions(userId: string) {
  return database.as(asUser(userId), (query) =>
    query<{ endpoint: string }>('select endpoint from public.push_subscriptions order by endpoint'),
  );
}

function recipients(kind: string, onDate: string) {
  return database.as(service, (query) =>
    query<{
      endpoint: string;
      language: string;
      message: string;
      first_count: number;
      second_count: number;
    }>(
      `select endpoint, language, message, first_count, second_count
       from public.service_push_recipients($1, $2::date) order by endpoint, message`,
      [kind, onDate],
    ),
  );
}

async function today(offset = 0): Promise<string> {
  const [row] = await database.query<{ day: string }>(
    'select (private.today() + $1::integer)::text as day',
    [offset],
  );
  return String(row?.day);
}

/** A visit by CRP A five days ago, with a step agreed for a check-back `days` from today. */
async function agreedStep(days: number, teacherId = scenario.staff.teacherA1) {
  const id = randomUUID();
  await database.query(
    `insert into public.visits (id, class_section_id, school_id, crp_id, teacher_id, status,
       visited_on, started_at)
     values ($1, $2, $3, $4, $5, 'done', private.today() - 5, now() - interval '5 days')`,
    [id, scenario.classA1Grade1Id, scenario.schoolA1Id, scenario.staff.crpA, teacherId],
  );
  await database.query(
    `insert into public.visit_feedback (visit_id, strength, practice_code, check_back_on, agreed_at)
     values ($1, 'Children read in pairs.', 'paired-reading', private.today() + $2::integer, now())`,
    [id, days],
  );
  return id;
}

describe('push subscriptions', () => {
  it('keeps one subscription per phone, for the account signed in on it', async () => {
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/phone-1');
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/phone-1');
    expect(await ownSubscriptions(scenario.staff.crpA)).toEqual([
      { endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1' },
    ]);
    // The phone passes to a teacher: the CRP's notifications stop reaching it.
    await keep(scenario.staff.teacherA1, 'https://fcm.googleapis.com/fcm/send/phone-1');
    expect(await ownSubscriptions(scenario.staff.crpA)).toEqual([]);
    expect(await ownSubscriptions(scenario.staff.teacherA1)).toEqual([
      { endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1' },
    ]);
  });

  it('refuses endpoints that are not secure or not a push service, and keys of the wrong shape', async () => {
    expect(
      await errorCodeOf(keep(scenario.staff.crpA, 'http://fcm.googleapis.com/fcm/send/x')),
    ).toBe('23514');
    for (const endpoint of [
      'https://push.example.org/x',
      'https://fcm.googleapis.com.example.org/x',
      'https://localhost/x',
    ]) {
      expect(await errorCodeOf(keep(scenario.staff.crpA, endpoint))).toBe('23514');
    }
    // The services of the common browsers are accepted.
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/x',
      'https://wns2-pn1p.notify.windows.com/w/?token=x',
    ]) {
      await keep(scenario.staff.crpA, endpoint);
    }
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.crpA), (query) =>
          query('select public.keep_push_subscription($1, $2, $3)', [
            'https://fcm.googleapis.com/fcm/send/x',
            'short',
            AUTH,
          ]),
        ),
      ),
    ).toBe('23514');
  });

  it('keeps each account to its own subscriptions and settings', async () => {
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/phone-1');
    expect(await ownSubscriptions(scenario.staff.crpB)).toEqual([]);
    const removed = await database.as(asUser(scenario.staff.crpB), (query) =>
      query('delete from public.push_subscriptions returning id'),
    );
    expect(removed).toEqual([]);
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.crpB), (query) =>
          query('insert into public.notification_settings (profile_id) values ($1)', [
            scenario.staff.crpA,
          ]),
        ),
      ),
    ).toBe('42501');
  });
});

describe('who is notified', () => {
  it("tells CRPs on Sunday of the coming week's check-backs and requests", async () => {
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/crp-a');
    await keep(scenario.staff.crpB, 'https://fcm.googleapis.com/fcm/send/crp-b');
    await agreedStep(3);
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.visit_requests (class_section_id, school_id, topic)
             values ($1, $2, 'reading')`,
        [scenario.classA1Grade2Id, scenario.schoolA1Id],
      ),
    );
    expect(await recipients('plan_ready', await today())).toEqual([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/crp-a',
        language: 'hi',
        message: 'plan_ready',
        first_count: 1,
        second_count: 1,
      },
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/crp-b',
        language: 'hi',
        message: 'plan_ready',
        first_count: 0,
        second_count: 0,
      },
    ]);
  });

  it("tells the cluster's CRPs and the teacher on the morning a check-back is due", async () => {
    const crpA2 = await provisionStaff(database.query, {
      fullName: 'CRP A2',
      role: 'crp',
      scopeId: scenario.clusterAId,
    });
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/crp-a');
    await keep(crpA2, 'https://fcm.googleapis.com/fcm/send/crp-a2');
    await keep(scenario.staff.crpB, 'https://fcm.googleapis.com/fcm/send/crp-b');
    await keep(scenario.staff.teacherA1, 'https://fcm.googleapis.com/fcm/send/teacher-a1');
    await keep(scenario.staff.teacherA2, 'https://fcm.googleapis.com/fcm/send/teacher-a2');
    await agreedStep(2);
    expect(await recipients('daily', await today())).toEqual([]);
    expect(await recipients('daily', await today(2))).toEqual([
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/crp-a',
        message: 'check_back_crp',
        first_count: 1,
      }),
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/crp-a2',
        message: 'check_back_crp',
        first_count: 1,
      }),
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/teacher-a1',
        message: 'check_back_teacher',
        first_count: 1,
      }),
    ]);
  });

  it('does not tell a teacher who has left the school', async () => {
    await keep(scenario.staff.teacherA1, 'https://fcm.googleapis.com/fcm/send/teacher-a1');
    await agreedStep(2);
    await database.query(
      `update public.staff_assignments set ends_on = private.today() where user_id = $1`,
      [scenario.staff.teacherA1],
    );
    expect(await recipients('daily', await today(2))).toEqual([]);
  });

  it('tells teachers the morning a Pulse week opens how many children of their classes are due', async () => {
    await keep(scenario.staff.teacherA1, 'https://fcm.googleapis.com/fcm/send/teacher-a1');
    // A colleague who does not teach the class is not told of it.
    await keep(scenario.staff.teacherA1Colleague, 'https://fcm.googleapis.com/fcm/send/colleague');
    await keep(scenario.staff.teacherB1, 'https://fcm.googleapis.com/fcm/send/teacher-b1');
    const [cycle] = await database.query<{ id: string }>(
      `insert into public.pulse_cycles (class_section_id, month, grade, language, first_week,
         eligible_count, sample_size, reserve_size)
       values ($1, date_trunc('month', private.today())::date, 1, 'hi', 1, 3, 3, 0)
       returning id`,
      [scenario.classA1Grade1Id],
    );
    for (const [index, student] of scenario.students.a1Active.entries()) {
      await database.query(
        `insert into public.pulse_samples (cycle_id, class_section_id, student_id, draw_position,
           week, opens_on, due_on, adapted)
         values ($1, $2, $3, $4, 1, private.today() + $5::integer, private.today() + 13, $6)`,
        [cycle?.id, scenario.classA1Grade1Id, student, index + 1, index === 2 ? 7 : 0, index === 1],
      );
    }
    expect(await recipients('daily', await today())).toEqual([
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/teacher-a1',
        message: 'pulse_week',
        first_count: 2,
      }),
    ]);
  });

  it('respects a kind switched off', async () => {
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/crp-a');
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query(
        `insert into public.notification_settings (profile_id, plan_ready) values (auth.uid(), false)`,
      ),
    );
    expect(await recipients('plan_ready', await today())).toEqual([]);
  });

  it('forgets subscriptions the push service dropped', async () => {
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/kept');
    await keep(scenario.staff.crpA, 'https://fcm.googleapis.com/fcm/send/dropped');
    await database.as(service, (query) =>
      query('select public.service_push_outcome($1, $2)', [
        ['https://fcm.googleapis.com/fcm/send/kept'],
        ['https://fcm.googleapis.com/fcm/send/dropped'],
      ]),
    );
    const rows = await database.query<{ endpoint: string; sent: boolean }>(
      'select endpoint, last_sent_at is not null as sent from public.push_subscriptions',
    );
    expect(rows).toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/kept', sent: true }]);
  });

  it('keeps the recipients to the secret key', async () => {
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.crpA), (query) =>
          query("select * from public.service_push_recipients('daily', current_date)"),
        ),
      ),
    ).toBe('42501');
  });
});
