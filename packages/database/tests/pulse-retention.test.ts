import { randomUUID } from 'node:crypto';
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

const service = { kind: 'service' } as const;

let monthsBack = 0;

/** A recorded check whose audio arrived `daysAgo` days ago, inserted directly as the owner. */
async function checkReceived(daysAgo: number): Promise<string> {
  // Each check gets a cycle of its own, in an earlier month, so the draws never collide.
  monthsBack += 1;
  const [cycle] = await database.query<{ id: string }>(
    `insert into public.pulse_cycles (class_section_id, month, grade, language,
       first_week, eligible_count, sample_size, reserve_size)
     values ($1, (date_trunc('month', now()) - make_interval(months => $2))::date, 1, 'hi', 1, 1,
       1, 0)
     returning id`,
    [scenario.classA1Grade1Id, monthsBack],
  );
  const [sample] = await database.query<{ id: string }>(
    `insert into public.pulse_samples (cycle_id, class_section_id, student_id, draw_position, week,
       opens_on, due_on)
     values ($1, $2, $3, 1, 1, private.today() - 60, private.today() - 54)
     returning id`,
    [cycle?.id, scenario.classA1Grade1Id, scenario.students.a1Active[0]],
  );
  const id = randomUUID();
  const path = `${scenario.classA1Grade1Id}/${String(sample?.id)}/${id}.webm`;
  await database.query(
    `insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
     values ('pulse-audio', $1, $2, '{"size": 1000, "mimetype": "audio/webm"}',
       now() - make_interval(days => $3))`,
    [path, scenario.staff.teacherA1, daysAgo],
  );
  await database.query(
    `insert into public.pulse_checks (id, sample_id, class_section_id, student_id, item_code,
       prompt_code, item, audio_path, audio_type, audio_bytes, duration_ms, reading_level,
       english_level, clarity, classroom, recorded_at, received_at)
     values ($1, $2, $3, $4, 'hi-g1-p01', 'en-g1-s01', '{}', $5, '', 0, 20000,
       'fluent', 'words', 'clear', 'normal', now() - make_interval(days => $6),
       now() - make_interval(days => $6))`,
    [id, sample?.id, scenario.classA1Grade1Id, scenario.students.a1Active[0], path, daysAgo],
  );
  return path;
}

async function unclaimedUpload(daysAgo: number): Promise<string> {
  const path = `${scenario.classA1Grade1Id}/${randomUUID()}/${randomUUID()}.webm`;
  await database.query(
    `insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
     values ('pulse-audio', $1, $2, '{"size": 1000, "mimetype": "audio/webm"}',
       now() - make_interval(days => $3))`,
    [path, scenario.staff.teacherA1, daysAgo],
  );
  return path;
}

function due(batchSize = 200) {
  return database.as(service, (query) =>
    query<{ path: string; reason: string }>(
      'select path, reason from public.service_pulse_audio_to_remove($1)',
      [batchSize],
    ),
  );
}

describe('recordings due for removal', () => {
  it('lists recordings older than 30 days and uploads unclaimed for two days', async () => {
    const old = await checkReceived(31);
    const recent = await checkReceived(29);
    const abandoned = await unclaimedUpload(3);
    const justUploaded = await unclaimedUpload(1);

    const rows = await due();
    expect(rows).toContainEqual({ path: old, reason: 'expired' });
    expect(rows).toContainEqual({ path: abandoned, reason: 'unclaimed' });
    const paths = rows.map((row) => row.path);
    expect(paths).not.toContain(recent);
    expect(paths).not.toContain(justUploaded);
  });

  it('stops listing a check once its audio is removed and marked', async () => {
    const old = await checkReceived(40);
    // What the Storage API does when the function removes the file.
    await database.query(
      `delete from storage.objects where bucket_id = 'pulse-audio' and name = $1`,
      [old],
    );
    const [marked] = await database.as(service, (query) =>
      query<{ count: number }>('select public.service_mark_pulse_audio_removed($1) as count', [
        [old],
      ]),
    );
    expect(marked?.count).toBe(1);
    expect((await due()).map((row) => row.path)).not.toContain(old);

    const [again] = await database.as(service, (query) =>
      query<{ count: number }>('select public.service_mark_pulse_audio_removed($1) as count', [
        [old],
      ]),
    );
    expect(again?.count).toBe(0);
  });

  it('lists a file uploaded again to the path of a check whose audio was removed', async () => {
    const old = await checkReceived(45);
    await database.as(service, (query) =>
      query('select public.service_mark_pulse_audio_removed($1)', [[old]]),
    );
    // The original file is still in the test storage, created 45 days ago: it is not kept.
    expect(await due()).toContainEqual({ path: old, reason: 'unclaimed' });
  });

  it('keeps each list within the batch size', async () => {
    await checkReceived(35);
    await checkReceived(36);
    await unclaimedUpload(5);
    await unclaimedUpload(6);
    expect(await due(1)).toHaveLength(2);
  });

  it('is available to the service role only', async () => {
    for (const userId of [scenario.staff.superAdmin, scenario.staff.teacherA1]) {
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) =>
            query('select * from public.service_pulse_audio_to_remove(10)'),
          ),
        ),
      ).toBe('42501');
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) =>
            query("select public.service_job_token_valid('pulse_retention', 'x')"),
          ),
        ),
      ).toBe('42501');
    }
  });
});

describe('the job token', () => {
  it('is created in Vault once and accepted only exactly', async () => {
    const [secret] = await database.query<{ token: string }>(
      `select decrypted_secret as token from vault.decrypted_secrets
       where name = 'pulse_retention_job_token'`,
    );
    expect(secret?.token).toMatch(/^[0-9a-f]{64}$/);

    const valid = (token: string) =>
      database.as(service, (query) =>
        query<{ valid: boolean }>(
          "select public.service_job_token_valid('pulse_retention', $1) as valid",
          [token],
        ),
      );
    expect((await valid(secret?.token ?? ''))[0]?.valid).toBe(true);
    expect((await valid('0'.repeat(64)))[0]?.valid).toBe(false);
    expect((await valid(''))[0]?.valid).toBe(false);
  });

  it('asks nothing of the network until the project URL is known', async () => {
    // pg_net is not part of the test database; the request quietly does nothing.
    await expect(database.query('select private.request_pulse_retention()')).resolves.toBeDefined();
  });
});
