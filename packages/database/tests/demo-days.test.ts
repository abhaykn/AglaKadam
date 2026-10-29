import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from './support/database';
import { createAuthIdentity, createScenario } from './support/scenario';

/**
 * Demonstration districts, built the way the `demo` Edge Function builds them: places, then the
 * accounts it creates through the Auth service, then each step of the history.
 */
let database: TestDatabase;

const service = { kind: 'service' } as const;

/** A sample recording as the function passes it: the teacher heard fluency, the engine did not. */
const SAMPLE_RECORDING = {
  key: 'class-2-halting',
  type: 'audio/mp4',
  grade: 2,
  item_code: 'hi-g2-p04',
  prompt_code: 'en-g2-s03',
  duration_ms: 41000,
  bytes: 330000,
  teacher_reading: 'fluent',
  teacher_english: 'words',
  shown: [
    { level: 'passage', atMs: 0 },
    { level: 'english', atMs: 30000 },
  ],
  score: {
    engine_version: 'pulse-engine 1.0 (indicconformer-600m-ctc; whisper-small)',
    reading_level: 'hesitant',
    reached_level: 'passage',
    reading_items: 41,
    reading_correct: 33,
    reading_seconds: 29.5,
    wcpm: 31,
    english_level: 'words',
    english_words: 3,
    english_seconds: 8.2,
    keyword_hits: 2,
    other_language_share: 0.04,
    confidence: 0.81,
    flags: [],
  },
};

interface Built {
  sandbox: string;
  accounts: Record<'teacher' | 'crp' | 'officer' | 'family', string>;
}

interface Needed {
  posted_on: string;
  accounts: { role: string; full_name?: string; scope?: string; student?: string }[];
  staff: { slot: string; full_name: string; role: string; scope: string }[];
}

function serviceCall<Row>(sql: string, params: unknown[]) {
  return database.as(service, (query) => query<Row>(sql, params)).then((rows) => rows[0]);
}

async function step(sandbox: string, phase: string, details: unknown = {}) {
  const row = await serviceCall<{ result: Record<string, unknown> }>(
    'select public.service_demo_build($1, $2, $3) as result',
    [sandbox, phase, JSON.stringify(details)],
  );
  return row?.result ?? {};
}

async function emailOf(userId: string): Promise<string> {
  const [row] = await database.query<{ email: string }>(
    'select email from auth.users where id = $1',
    [userId],
  );
  return String(row?.email);
}

/** What the Edge Function does: open, places, accounts, and as many history steps as asked. */
async function buildDemo(clientKey: string, phases: string[]): Promise<Built> {
  const opened = await serviceCall<{ result: { status: string; sandbox: string } }>(
    'select public.service_demo_open($1) as result',
    [clientKey],
  );
  const sandbox = String(opened?.result.sandbox);
  const needed = (await step(sandbox, 'places')) as unknown as Needed;

  const staff: Record<string, string> = {};
  for (const person of needed.staff) {
    staff[person.slot] = await createAuthIdentity(database.query, {
      provisioning: {
        account_kind: 'staff',
        full_name: person.full_name,
        password_change_required: false,
        assignment: { role: person.role, scope_id: person.scope, starts_on: needed.posted_on },
      },
    });
  }
  const accounts: Record<string, { id: string; email: string }> = {};
  const ids: Record<string, string> = {};
  for (const account of needed.accounts) {
    const id =
      account.role === 'family'
        ? await createAuthIdentity(database.query, {
            provisioning: {
              account_kind: 'student',
              student_id: account.student,
              preferred_language: 'en',
            },
          })
        : await createAuthIdentity(database.query, {
            provisioning: {
              account_kind: 'staff',
              full_name: account.full_name,
              preferred_language: 'en',
              password_change_required: false,
              assignment: {
                role: account.role === 'officer' ? 'block_officer' : account.role,
                scope_id: account.scope,
                starts_on: needed.posted_on,
              },
            },
          });
    accounts[account.role] = { id, email: await emailOf(id) };
    ids[account.role] = id;
  }
  await step(sandbox, 'people', { accounts, staff });
  for (const phase of phases) {
    await step(sandbox, phase, phase === 'finish' ? { recordings: [SAMPLE_RECORDING] } : {});
  }
  return { sandbox, accounts: ids };
}

/**
 * A demonstration district must give the visitors something to do on every day of the month, also
 * in the catch-up days after a month's fourth week (the 29th to the 31st), when every week of the
 * month is over. The clock is moved, so the district is built as it would be on that day.
 */
const DAYS = ['2026-10-29', '2026-11-03', '2026-11-30'];

afterAll(() => {
  vi.useRealTimers();
});

describe('a demonstration district on any day of the month', () => {
  for (const day of DAYS) {
    it(`keeps this week's checks for the teacher and the recording in the planned class on ${day}`, async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${day}T06:30:00Z`) });
      database = await createTestDatabase();
      try {
        await database.begin();
        await createScenario(database);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const built = await buildDemo(`network-${String(attempt)}`, [
            'attendance',
            'draws',
            'pulse',
            'coaching',
            'exams',
            'notes',
            'finish',
          ]);
          const [row] = await database.query<{ in_planned: string; pending: string }>(
            `select
               (select count(*) from public.pulse_checks as k
                join private.demo_places as p on p.class_section_id = k.class_section_id
                join public.visits as v on v.class_section_id = k.class_section_id and v.status = 'planned'
                where p.sandbox_id = $1 and k.audio_bytes = 330000) as in_planned,
               (select count(*) from public.pulse_samples as s
                join public.pulse_cycles as c on c.id = s.cycle_id
                join public.class_teachers as t on t.class_section_id = s.class_section_id
                where t.teacher_id = $2 and s.week is not null and s.opens_on <= private.today()
                  and c.month = date_trunc('month', private.today())::date
                  and not exists (select 1 from public.pulse_checks as k where k.sample_id = s.id)) as pending`,
            [built.sandbox, built.accounts.teacher],
          );
          expect(Number(row?.in_planned)).toBe(1);
          expect(Number(row?.pending)).toBeGreaterThan(0);
        }
      } finally {
        await database.close();
        vi.useRealTimers();
      }
    }, 1_200_000);
  }
});
