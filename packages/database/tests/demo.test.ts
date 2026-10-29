import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { feedbackFingerprint } from '../../../supabase/functions/_shared/feedback-fingerprint';
import { createTestDatabase, type TestDatabase } from './support/database';
import { asUser, createAuthIdentity, createScenario, type Scenario } from './support/scenario';

/**
 * Demonstration districts, built the way the `demo` Edge Function builds them: places, then the
 * accounts it creates through the Auth service, then each step of the history.
 */
let database: TestDatabase;
let scenario: Scenario;
let demo: Built;

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

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const [row] = await database.query<{ total: string | number }>(sql, params);
  return Number(row?.total ?? 0);
}

async function schoolsOf(sandbox: string): Promise<string[]> {
  const rows = await database.query<{ school_id: string }>(
    'select distinct school_id from private.demo_places where sandbox_id = $1',
    [sandbox],
  );
  return rows.map((row) => row.school_id);
}

beforeAll(async () => {
  database = await createTestDatabase();
  await database.begin();
  scenario = await createScenario(database);
  demo = await buildDemo('network-a', [
    'attendance',
    'draws',
    'pulse',
    'coaching',
    'exams',
    'notes',
    'finish',
  ]);
}, 600_000);

afterAll(async () => {
  await database.rollback();
  await database.close();
});

describe('a demonstration district', () => {
  it('holds sixteen schools, their children and months of history', async () => {
    const schools = await schoolsOf(demo.sandbox);
    expect(schools).toHaveLength(16);
    expect(
      await count('select count(*) as total from private.demo_places where sandbox_id = $1', [
        demo.sandbox,
      ]),
    ).toBe(48);
    const children = await count(
      'select count(*) as total from public.students where school_id = any ($1::uuid[])',
      [schools],
    );
    expect(children).toBeGreaterThan(900);
    expect(children).toBeLessThan(1500);
    expect(
      await count(
        `select count(*) as total from public.attendance_sessions as a
         join private.demo_places as p on p.class_section_id = a.class_section_id
         where p.sandbox_id = $1`,
        [demo.sandbox],
      ),
    ).toBeGreaterThan(1000);
    const checks = await count(
      `select count(*) as total from public.pulse_checks as k
       join private.demo_places as p on p.class_section_id = k.class_section_id
       where p.sandbox_id = $1`,
      [demo.sandbox],
    );
    expect(checks).toBeGreaterThan(1500);
    // Every recorded check was scored by the engine.
    expect(
      await count(
        `select count(*) as total from public.pulse_checks as k
         join private.demo_places as p on p.class_section_id = k.class_section_id
         left join public.pulse_scores as s on s.check_id = k.id
         where p.sandbox_id = $1 and k.mode = 'recorded' and s.check_id is null`,
        [demo.sandbox],
      ),
    ).toBe(0);
    const visits = await database.query<{
      crp_id: string;
      done: string;
      planned: string;
      scored: string;
    }>(
      `select v.crp_id, count(*) filter (where v.status = 'done') as done,
         count(*) filter (where v.status = 'planned') as planned,
         count(sc.visit_id) as scored
       from public.visits as v
       join private.demo_places as p on p.class_section_id = v.class_section_id
       left join public.visit_feedback_scores as sc on sc.visit_id = v.id
       where p.sandbox_id = $1
       group by v.crp_id`,
      [demo.sandbox],
    );
    expect(visits).toHaveLength(2);
    const own = visits.find((row) => row.crp_id === demo.accounts.crp);
    expect(Number(own?.done)).toBeGreaterThan(20);
    expect(Number(own?.planned)).toBe(3);
    expect(Number(own?.scored)).toBeGreaterThan(10);
    // The audit trail records nothing of the history (only the accounts, as for any account).
    expect(
      await count(
        `select count(*) as total from public.audit_events
         where table_name = 'students' and operation = 'INSERT' and record_id = any (
           select id::text from public.students where school_id = any ($1::uuid[]))`,
        [schools],
      ),
    ).toBe(0);
  });

  it('leaves this week to the visitor teacher, and shows them only their own school', async () => {
    const pending = await count(
      `select count(*) as total
       from public.pulse_samples as s
       join public.pulse_cycles as c on c.id = s.cycle_id
       join public.class_teachers as t on t.class_section_id = s.class_section_id
       where t.teacher_id = $1 and s.week is not null and s.opens_on <= private.today()
         and c.month = date_trunc('month', private.today())::date
         and not exists (select 1 from public.pulse_checks as k where k.sample_id = s.id)`,
      [demo.accounts.teacher],
    );
    expect(pending).toBeGreaterThan(0);
    const visible = await database.as(asUser(demo.accounts.teacher), (query) =>
      query<{ school_id: string }>('select distinct school_id from public.students'),
    );
    expect(visible).toHaveLength(1);
    const real = await database.as(asUser(demo.accounts.teacher), (query) =>
      query('select id from public.students where school_id = $1', [scenario.schoolA1Id]),
    );
    expect(real).toEqual([]);
    const demoSchools = await schoolsOf(demo.sandbox);
    const fromReal = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select id from public.students where school_id = any ($1::uuid[])', [demoSchools]),
    );
    expect(fromReal).toEqual([]);
  });

  it("shows the officer the block's figures, holding back the few English-medium classes", async () => {
    const [row] = await database.as(asUser(demo.accounts.officer), (query) =>
      query<{ report: Record<string, unknown> }>('select public.area_report(6) as report'),
    );
    const report = row?.report;
    expect(report).toMatchObject({ schools: 16, classes: 48 });
    const pulse = report?.pulse as { grade: number; language: string; withheld: boolean }[];
    const hindi = pulse.filter((entry) => entry.language === 'hi');
    const english = pulse.filter((entry) => entry.language === 'en');
    expect(hindi.length).toBeGreaterThan(0);
    expect(hindi.every((entry) => !entry.withheld)).toBe(true);
    expect(english.length).toBeGreaterThan(0);
    expect(english.every((entry) => entry.withheld)).toBe(true);
    const coaching = report?.coaching as { visits_done: unknown; time_to_feedback: unknown }[];
    expect(coaching.at(-1)?.visits_done).not.toBeNull();
    expect(coaching.at(-1)?.time_to_feedback).not.toBeNull();
  });

  it("gives the family their child's attendance, shared results and the class's notes", async () => {
    const family = asUser(demo.accounts.family);
    const attendance = await database.as(family, (query) =>
      query<{ result: { month: string }[] | null }>('select public.my_attendance() as result'),
    );
    expect(attendance[0]?.result).not.toBeNull();
    const marks = await database.as(family, (query) =>
      query('select paper_id from public.exam_marks'),
    );
    expect(marks.length).toBeGreaterThan(0);
    const notes = await database.as(family, (query) => query('select id from public.class_notes'));
    expect(notes.length).toBeGreaterThan(2);
  });

  it('scores feedback with the fingerprint the phone computes', async () => {
    const rows = await database.query<{
      strength: string;
      evidence: ({ moment: string } | { item: string })[];
      practice_code: string;
      change_note: string | null;
      technique: string | null;
      demo_given: boolean;
      plan_note: string | null;
      check_back_on: string;
      feedback_fingerprint: string;
    }>(
      `select f.strength, f.evidence, f.practice_code, f.change_note, f.technique, f.demo_given,
         f.plan_note, f.check_back_on::text, s.feedback_fingerprint
       from public.visit_feedback_scores as s
       join public.visit_feedback as f on f.visit_id = s.visit_id
       where s.crp_id = $1
       order by s.scored_at desc
       limit 5`,
      [demo.accounts.crp],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        await feedbackFingerprint({
          strength: row.strength,
          evidence: row.evidence.map((entry) =>
            'moment' in entry ? `moment:${entry.moment}` : `item:${entry.item}`,
          ),
          practiceCode: row.practice_code,
          changeNote: row.change_note,
          technique: row.technique,
          demoGiven: row.demo_given,
          planNote: row.plan_note,
          checkBackOn: row.check_back_on,
        }),
      ).toBe(row.feedback_fingerprint);
    }
  });

  it('tells a visitor their district and role, and every real account nothing', async () => {
    // The function finds the visitor's district and the account of another role, to switch.
    const sandbox = await serviceCall<{ result: string | null }>(
      'select public.service_demo_sandbox_of($1) as result',
      [demo.accounts.crp],
    );
    expect(sandbox?.result).toBe(demo.sandbox);
    const officer = await serviceCall<{ result: string | null }>(
      'select public.service_demo_account($1, $2) as result',
      [demo.sandbox, 'officer'],
    );
    expect(officer?.result).toBe(await emailOf(demo.accounts.officer));
    const outsider = await serviceCall<{ result: string | null }>(
      'select public.service_demo_sandbox_of($1) as result',
      [scenario.staff.crpA],
    );
    expect(outsider?.result).toBeNull();

    const [mine] = await database.as(asUser(demo.accounts.crp), (query) =>
      query<{ demo: Record<string, unknown> | null }>('select public.my_demo() as demo'),
    );
    expect(mine?.demo).toMatchObject({
      role: 'crp',
      school: 'Primary School Bhagwanpur',
      people: { teacher: 'Anita Sharma', crp: 'Rajeev Kumar Mishra' },
    });
    const [real] = await database.as(asUser(scenario.staff.crpA), (query) =>
      query<{ demo: unknown }>('select public.my_demo() as demo'),
    );
    expect(real?.demo).toBeNull();
  });

  it('keeps demonstrations out of the overview, the administrator report and the engine', async () => {
    const [overview] = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ result: { schools: number; districts: number } }>(
        'select public.admin_overview() as result',
      ),
    );
    expect(overview?.result).toMatchObject({ schools: 4, districts: 1 });
    const [report] = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ result: { schools: number } }>('select public.area_report(6) as result'),
    );
    expect(report?.result.schools).toBe(4);
    const queue = await database.as(service, (query) =>
      query("select check_id from public.service_pulse_checks_to_score(500, 'pulse-engine 2.0')"),
    );
    expect(queue).toEqual([]);
  });

  it('hides demonstration districts from every real account, administrators included', async () => {
    const schools = await schoolsOf(demo.sandbox);
    const [district] = await database.query<{ district_id: string }>(
      'select district_id from private.demo_sandboxes where id = $1',
      [demo.sandbox],
    );
    for (const staff of [scenario.staff.superAdmin, scenario.staff.crpA]) {
      const seen = await database.as(asUser(staff), (query) =>
        query<{ total: string }>(
          `select (select count(*) from public.schools where id = any ($1::uuid[]))
             + (select count(*) from public.students where school_id = any ($1::uuid[]))
             + (select count(*) from public.class_sections where school_id = any ($1::uuid[]))
             + (select count(*) from public.districts where id = $2)
             + (select count(*) from public.blocks where district_id = $2)
             + (select count(*) from public.states where code = 'DEMO')
             + (select count(*) from public.profiles where id = any ($3::uuid[]))
             + (select count(*) from public.staff_assignments where user_id = any ($3::uuid[]))
             as total`,
          [schools, district?.district_id, Object.values(demo.accounts)],
        ),
      );
      expect(Number(seen[0]?.total)).toBe(0);
    }
    // The visitor still sees their own district, and the administrator every real school.
    const own = await database.as(asUser(demo.accounts.officer), (query) =>
      query('select id from public.districts where id = $1', [district?.district_id]),
    );
    expect(own).toHaveLength(1);
    const real = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query('select id from public.schools'),
    );
    expect(real).toHaveLength(4);
  });

  it('leaves no trace of what a visitor does in the audit trail', async () => {
    const [child] = await database.query<{ id: string }>(
      `select st.id from public.students as st
       join public.enrolments as e on e.student_id = st.id
       join public.class_teachers as t on t.class_section_id = e.class_section_id
       where t.teacher_id = $1 and st.status = 'active' limit 1`,
      [demo.accounts.teacher],
    );
    const before = await count('select count(*) as total from public.audit_events');
    await database.as(asUser(demo.accounts.teacher), (query) =>
      query(
        `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method)
         values ($1, 'audio_assessment', true, 'Ramesh Kumar', 'paper_form')`,
        [child?.id],
      ),
    );
    expect(await count('select count(*) as total from public.audit_events')).toBe(before);
  });

  it('tells a teacher every passage a child of their school was given before', async () => {
    const [child] = await database.query<{ student_id: string }>(
      `select k.student_id from public.pulse_checks as k
       join public.class_teachers as t on t.class_section_id = k.class_section_id
       where t.teacher_id = $1 limit 1`,
      [demo.accounts.teacher],
    );
    const seen = await database.as(asUser(demo.accounts.teacher), (query) =>
      query<{ item_code: string }>('select item_code from public.pulse_items_seen($1)', [
        [child?.student_id, scenario.students.a1Active[0]],
      ]),
    );
    expect(seen.length).toBeGreaterThan(0);
    // Nothing of a child in a school that is not theirs.
    const other = await database.as(asUser(demo.accounts.teacher), (query) =>
      query('select item_code from public.pulse_items_seen($1)', [[scenario.students.a1Active[0]]]),
    );
    expect(other).toEqual([]);
  });

  it('keeps visitors apart, and limits how many districts one network opens', async () => {
    const other = await buildDemo('network-b', []);
    const otherSchools = await schoolsOf(other.sandbox);
    const seen = await database.as(asUser(demo.accounts.teacher), (query) =>
      query('select id from public.students where school_id = any ($1::uuid[])', [otherSchools]),
    );
    expect(seen).toEqual([]);
    // Judges at one venue share a network: twenty an hour, then a wait of under an hour.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const opened = await serviceCall<{ result: { status: string } }>(
        'select public.service_demo_open($1) as result',
        ['network-c'],
      );
      expect(opened?.result.status).toBe('ok');
    }
    const refused = await serviceCall<{
      result: { status: string; retry_after_seconds: number };
    }>('select public.service_demo_open($1) as result', ['network-c']);
    expect(refused?.result.status).toBe('throttled');
    expect(refused?.result.retry_after_seconds).toBeGreaterThan(3500);
    expect(refused?.result.retry_after_seconds).toBeLessThanOrEqual(3600);
  });

  it('places the sample recordings where the CRP will listen to them', async () => {
    const [placed] = await database.query<{
      audio_path: string;
      reading_level: string;
      engine: string;
    }>(
      `select k.audio_path, k.reading_level, s.reading_level as engine
       from public.pulse_checks as k
       join public.pulse_scores as s on s.check_id = k.id
       join private.demo_places as p on p.class_section_id = k.class_section_id
       where p.sandbox_id = $1 and k.item_code = 'hi-g2-p04' and k.audio_bytes = 330000`,
      [demo.sandbox],
    );
    expect(placed?.audio_path).toMatch(/\.m4a$/);
    expect(placed).toMatchObject({ reading_level: 'fluent', engine: 'hesitant' });
    // The CRP sees it, not yet heard, with its audio still kept.
    const heard = await database.as(asUser(demo.accounts.crp), (query) =>
      query<{ id: string }>(
        `select k.id from public.pulse_checks as k
         left join public.pulse_reviews as r on r.check_id = k.id
         where k.audio_path = $1 and k.audio_deleted_at is null and r.check_id is null`,
        [placed?.audio_path],
      ),
    );
    expect(heard).toHaveLength(1);
    // It waits in the Class 2 the CRP plans to visit next.
    const planned = await count(
      `select count(*) as total from public.visits as v
       join public.pulse_checks as k on k.class_section_id = v.class_section_id
       where k.audio_path = $1 and v.status = 'planned'`,
      [placed?.audio_path],
    );
    expect(planned).toBe(1);
  });

  it('dates papers and check-backs on school days, as a school would', async () => {
    const offDays = await count(
      `select count(*) as total from (
         select paper.held_on as day from public.exam_papers as paper
         join private.demo_places as p on p.class_section_id = paper.class_section_id
         where p.sandbox_id = $1
         union all
         select f.check_back_on from public.visit_feedback as f
         join public.visits as v on v.id = f.visit_id
         join private.demo_places as p on p.class_section_id = v.class_section_id
         where p.sandbox_id = $1
       ) as dated
       where not exists (select 1 from private.demo_school_days(dated.day, dated.day))`,
      [demo.sandbox],
    );
    expect(offDays).toBe(0);
    // Every paper lies within the days of its exam.
    expect(
      await count(
        `select count(*) as total from public.exam_papers as paper
         join public.exams as e on e.id = paper.exam_id
         join private.demo_places as p on p.class_section_id = paper.class_section_id
         where p.sandbox_id = $1 and paper.held_on not between e.starts_on and e.ends_on`,
        [demo.sandbox],
      ),
    ).toBe(0);
  });

  it("answers teachers' requests for a visit soon after they are made", async () => {
    const waiting = await database.query<{ note: string }>(
      `select r.note from public.visit_requests as r
       join private.demo_places as p on p.class_section_id = r.class_section_id
       left join public.visits as v on v.id = r.answered_by_visit_id
       where p.sandbox_id = $1 and r.answered_by_visit_id is null`,
      [demo.sandbox],
    );
    // Only this week's request is still open, and the next planned visit answers it.
    expect(waiting).toHaveLength(1);
    expect(
      await count(
        `select count(*) as total from public.visits as v
         join public.visit_requests as r on r.id = v.request_id
         join private.demo_places as p on p.class_section_id = v.class_section_id
         where p.sandbox_id = $1 and v.status = 'planned'`,
        [demo.sandbox],
      ),
    ).toBe(1);
  });

  it('removes an expired district with nothing left behind', async () => {
    const schools = await schoolsOf(demo.sandbox);
    // An identity the function made for this district but the district never took in, as when
    // building stops half-way.
    const stray = await createAuthIdentity(database.query, {});
    await serviceCall('select public.service_demo_note_account($1, $2) as result', [
      demo.sandbox,
      stray,
    ]);
    await database.query(
      `update private.demo_sandboxes set expires_at = now() - interval '1 minute' where id = $1`,
      [demo.sandbox],
    );
    const due = await serviceCall<{ result: { sandbox: string }[] }>(
      'select public.service_demo_due(20) as result',
      [],
    );
    expect(due?.result.map((row) => row.sandbox)).toContain(demo.sandbox);
    await serviceCall('select public.service_demo_removing($1) as result', [demo.sandbox]);
    const removed = await serviceCall<{ result: boolean }>(
      'select public.service_demo_remove($1) as result',
      [demo.sandbox],
    );
    expect(removed?.result).toBe(true);
    // Its identities wait on a list until the Auth service has deleted them: the visitor's four
    // and the stray one, never the background staff shared with other districts.
    const listed = await serviceCall<{ result: string[] }>(
      'select public.service_demo_accounts_to_delete(200) as result',
      [],
    );
    expect([...(listed?.result ?? [])].sort()).toEqual(
      [...Object.values(demo.accounts), stray].sort(),
    );
    expect(
      await serviceCall<{ result: boolean }>(
        'select public.service_is_demo_account($1) as result',
        [stray],
      ),
    ).toEqual({ result: true });
    // The Edge Function then deletes the accounts through the Auth service.
    await database.query('delete from auth.users where id = any ($1::uuid[])', [listed?.result]);
    for (const id of listed?.result ?? []) {
      await serviceCall('select public.service_demo_account_deleted($1) as result', [id]);
    }
    const left = await serviceCall<{ result: string[] }>(
      'select public.service_demo_accounts_to_delete(200) as result',
      [],
    );
    expect(left?.result).toEqual([]);
    for (const table of ['students', 'class_sections', 'staff_assignments']) {
      expect(
        await count(
          `select count(*) as total from public.${table} where school_id = any ($1::uuid[])`,
          [schools],
        ),
      ).toBe(0);
    }
    expect(
      await count('select count(*) as total from public.schools where id = any ($1::uuid[])', [
        schools,
      ]),
    ).toBe(0);
    expect(
      await count('select count(*) as total from private.demo_sandboxes where id = $1', [
        demo.sandbox,
      ]),
    ).toBe(0);
    expect(
      await count(
        `select count(*) as total from public.audit_events where operation = 'DELETE' and table_name = 'schools'`,
      ),
    ).toBe(0);
  });
});
