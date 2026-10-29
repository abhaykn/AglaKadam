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
const ENGINE = 'pulse-engine 1.0';

let monthsBack = 0;

interface CheckOptions {
  /** Days since the server received the check. */
  receivedDaysAgo?: number;
  adapted?: boolean;
  teacherReading?: string;
  teacherEnglish?: string;
}

/** A check of a drawn child of class A1 Grade 1, in a month of its own, inserted as the owner. */
async function check(options: CheckOptions = {}): Promise<{ id: string; path: string | null }> {
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
       opens_on, due_on, adapted)
     values ($1, $2, $3, 1, 1, private.today() - 60, private.today() - 54, $4)
     returning id`,
    [cycle?.id, scenario.classA1Grade1Id, scenario.students.a1Active[0], options.adapted ?? false],
  );
  const id = randomUUID();
  const days = options.receivedDaysAgo ?? 1;
  if (options.adapted) {
    await database.query(
      `insert into public.pulse_checks (id, sample_id, class_section_id, student_id, mode,
         reading_level, english_level, recorded_at, received_at)
       values ($1, $2, $3, $4, 'adapted', 'hesitant', 'words',
         now() - make_interval(days => $5), now() - make_interval(days => $5))`,
      [id, sample?.id, scenario.classA1Grade1Id, scenario.students.a1Active[0], days],
    );
    return { id, path: null };
  }
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
     values ($1, $2, $3, $4, 'hi-g1-p01', 'en-g1-s01', '{"shown": []}', $5, '', 0, 58000, $6, $7,
       'clear', 'normal', now() - make_interval(days => $8), now() - make_interval(days => $8))`,
    [
      id,
      sample?.id,
      scenario.classA1Grade1Id,
      scenario.students.a1Active[0],
      path,
      options.teacherReading ?? 'fluent',
      options.teacherEnglish ?? 'words',
      days,
    ],
  );
  return { id, path };
}

interface ScoreValues {
  engine?: string;
  readingLevel?: string;
  englishLevel?: string;
  reachedLevel?: string;
  wcpm?: number | null;
  classSectionId?: string;
}

/** Writes a score the way the engine does, replacing an earlier one. */
function score(checkId: string, values: ScoreValues = {}) {
  return database.as(service, (query) =>
    query<{ class_section_id: string; engine_version: string }>(
      `insert into public.pulse_scores (check_id, class_section_id, engine_version, reading_level,
         reached_level, reading_items, reading_correct, reading_seconds, wcpm, english_level,
         english_words, english_seconds, keyword_hits, other_language_share, confidence, flags,
         transcript)
       values ($1, $2, $3, $4, $5, 24, 20, 38.5, $6, $7, 6, 17.5, 2, 0.1, 0.82, '{}',
         '{"reading": "...", "english": "..."}')
       on conflict (check_id) do update set
         engine_version = excluded.engine_version,
         reading_level = excluded.reading_level,
         reached_level = excluded.reached_level,
         wcpm = excluded.wcpm,
         english_level = excluded.english_level,
         transcript = excluded.transcript
       returning class_section_id, engine_version`,
      [
        checkId,
        values.classSectionId ?? scenario.classA1Grade1Id,
        values.engine ?? ENGINE,
        values.readingLevel ?? 'fluent',
        values.reachedLevel ?? 'passage',
        values.wcpm === undefined ? 31.2 : values.wcpm,
        values.englishLevel ?? 'words',
      ],
    ),
  );
}

function due(batchSize = 50, engine = ENGINE) {
  return database.as(service, (query) =>
    query('select * from public.service_pulse_checks_to_score($1, $2)', [batchSize, engine]),
  );
}

describe('checks to score', () => {
  it('lists recorded checks with their recording and item, oldest first, without the teacher’s levels', async () => {
    const older = await check({ receivedDaysAgo: 5 });
    const newer = await check({ receivedDaysAgo: 2 });
    await check({ adapted: true });
    const rows = await due();
    const ids = rows.map((row) => row.check_id);
    expect(ids.indexOf(older.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
    expect(rows.find((row) => row.check_id === older.id)).toEqual({
      check_id: older.id,
      audio_path: older.path,
      // Stamped from the stored file when the check was recorded.
      audio_type: 'audio/webm',
      item: { shown: [] },
      grade: 1,
      reading_language: 'hi',
      duration_ms: 58000,
      item_seen_before: false,
    });
    // Adapted checks have no recording; they are never scored by a machine.
    expect(rows).toHaveLength(2);
  });

  it('skips scored checks, lists them again for a new engine, and keeps to the batch size', async () => {
    const first = await check({ receivedDaysAgo: 4 });
    const second = await check({ receivedDaysAgo: 3 });
    await score(first.id);
    expect((await due()).map((row) => row.check_id)).toEqual([second.id]);
    // A new engine scores the unscored first, then rescores the rest.
    expect((await due(50, 'pulse-engine 2.0')).map((row) => row.check_id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await due(1, 'pulse-engine 2.0')).toHaveLength(1);
  });

  it('puts checks already tried after the others, so that a bad file never blocks the queue', async () => {
    const tried = await check({ receivedDaysAgo: 9 });
    const fresh = await check({ receivedDaysAgo: 1 });
    await database.as(service, (query) =>
      query('select public.service_record_pulse_score_failure($1, $2, $3)', [
        tried.id,
        ENGINE,
        'Scoring started; the run ended before it finished.',
      ]),
    );
    const ids = (await due()).map((row) => row.check_id);
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(tried.id));
  });

  it('leaves out recordings that were already deleted', async () => {
    const removed = await check();
    await database.query('update public.pulse_checks set audio_deleted_at = now() where id = $1', [
      removed.id,
    ]);
    expect((await due()).map((row) => row.check_id)).not.toContain(removed.id);
  });

  it('gives up on a check after three failures with the same engine, and tries again with a new one', async () => {
    const damaged = await check();
    const fail = (engine: string) =>
      database.as(service, (query) =>
        query<{ attempts: number }>(
          'select public.service_record_pulse_score_failure($1, $2, $3) as attempts',
          [damaged.id, engine, 'The recording could not be decoded.'],
        ),
      );
    for (const expected of [1, 2, 3]) {
      expect((await fail(ENGINE))[0]?.attempts).toBe(expected);
    }
    expect((await due()).map((row) => row.check_id)).not.toContain(damaged.id);
    expect((await due(50, 'pulse-engine 2.0')).map((row) => row.check_id)).toContain(damaged.id);
    expect((await fail('pulse-engine 2.0'))[0]?.attempts).toBe(1);

    // Writing the reason of an attempt already counted does not count it again.
    const [again] = await database.as(service, (query) =>
      query<{ attempts: number }>(
        'select public.service_record_pulse_score_failure($1, $2, $3, false) as attempts',
        [damaged.id, 'pulse-engine 2.0', 'The decoder stopped.'],
      ),
    );
    expect(again?.attempts).toBe(1);

    // Scoring it at last clears the failure.
    await score(damaged.id);
    const [left] = await database.query<{ count: number }>(
      'select count(*)::int as count from public.pulse_score_failures where check_id = $1',
      [damaged.id],
    );
    expect(left?.count).toBe(0);
  });
});

describe('writing scores', () => {
  it('takes the class from the check, and replaces an earlier score', async () => {
    const recorded = await check();
    const [first] = await score(recorded.id, { classSectionId: scenario.classB1Grade1Id });
    expect(first).toEqual({ class_section_id: scenario.classA1Grade1Id, engine_version: ENGINE });
    await score(recorded.id, { engine: 'pulse-engine 2.0', readingLevel: 'hesitant' });
    const rows = await database.query<{ engine_version: string; reading_level: string }>(
      'select engine_version, reading_level from public.pulse_scores where check_id = $1',
      [recorded.id],
    );
    expect(rows).toEqual([{ engine_version: 'pulse-engine 2.0', reading_level: 'hesitant' }]);
  });

  it('scores no adapted check, and keeps the measures consistent', async () => {
    const adapted = await check({ adapted: true });
    expect(await errorCodeOf(score(adapted.id))).toBe('23514');
    const recorded = await check();
    // Words correct per minute belong to a passage only.
    expect(await errorCodeOf(score(recorded.id, { reachedLevel: 'words' }))).toBe('23514');
    await score(recorded.id, { reachedLevel: 'words', wcpm: null });
    expect(await errorCodeOf(score(recorded.id, { readingLevel: 'excellent' }))).toBe('23514');
  });

  it('lets only the engine write scores and runs', async () => {
    const recorded = await check();
    for (const userId of [scenario.staff.superAdmin, scenario.staff.teacherA1]) {
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) =>
            query(
              `insert into public.pulse_scores (check_id, class_section_id, engine_version,
                 reading_level, reached_level, reading_items, reading_correct, reading_seconds,
                 english_level, english_words, english_seconds, keyword_hits,
                 other_language_share, confidence)
               values ($1, $2, 'x', 'fluent', 'passage', 1, 1, 1, 'words', 1, 1, 0, 0, 1)`,
              [recorded.id, scenario.classA1Grade1Id],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) =>
            query(
              `insert into public.pulse_scoring_runs (runner, engine_version, started_at, scored, failed)
               values ('local', 'x', now(), 0, 0)`,
            ),
          ),
        ),
      ).toBe('42501');
    }
    for (const fn of [
      `select public.service_pulse_checks_to_score(10, 'x')`,
      `select public.service_record_pulse_score_failure('${recorded.id}', 'x', 'y')`,
      `select public.service_pulse_agreement(now(), 'x')`,
    ]) {
      expect(
        await errorCodeOf(database.as(asUser(scenario.staff.superAdmin), (query) => query(fn))),
      ).toBe('42501');
    }
  });
});

describe('reading scores', () => {
  it('shows a check’s score to the school and its CRP only', async () => {
    const recorded = await check();
    await score(recorded.id);
    const read = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query('select check_id from public.pulse_scores where check_id = $1', [recorded.id]),
      );
    expect(await read(scenario.staff.teacherA1)).toHaveLength(1);
    expect(await read(scenario.staff.crpA)).toHaveLength(1);
    expect(await read(scenario.staff.superAdmin)).toHaveLength(1);
    expect(await read(scenario.staff.teacherA2)).toEqual([]);
    expect(await read(scenario.staff.teacherB1)).toEqual([]);
    expect(await read(scenario.familyAccountId)).toEqual([]);
  });

  it('shows the scoring runs to administrators only', async () => {
    await database.as(service, (query) =>
      query(
        `insert into public.pulse_scoring_runs (runner, engine_version, started_at, scored, failed,
           compared, reading_kappa, english_kappa)
         values ('scheduled', $1, now() - interval '5 minutes', 12, 1, 40, 0.74, 0.68)`,
        [ENGINE],
      ),
    );
    const read = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query('select scored from public.pulse_scoring_runs where engine_version = $1', [ENGINE]),
      );
    expect(await read(scenario.staff.superAdmin)).toEqual([{ scored: 12 }]);
    expect(await read(scenario.staff.crpA)).toEqual([]);
    expect(await read(scenario.staff.teacherA1)).toEqual([]);
  });

  it('pairs the teacher’s and the engine’s levels for measuring agreement', async () => {
    const agreed = await check({ teacherReading: 'fluent', teacherEnglish: 'sentences' });
    const differed = await check({ teacherReading: 'needs_support', teacherEnglish: 'words' });
    await check();
    const alsoAgreed = await check({ teacherReading: 'fluent', teacherEnglish: 'sentences' });
    const olderEngine = await check({ teacherReading: 'fluent', teacherEnglish: 'sentences' });
    await score(agreed.id, { readingLevel: 'fluent', englishLevel: 'sentences' });
    await score(alsoAgreed.id, { readingLevel: 'fluent', englishLevel: 'sentences' });
    await score(differed.id, { readingLevel: 'hesitant', englishLevel: 'no_response' });
    // Another engine's scores are not mixed in.
    await score(olderEngine.id, {
      engine: 'pulse-engine 0.9',
      readingLevel: 'needs_support',
      englishLevel: 'words',
    });
    const pairs = await database.as(service, (query) =>
      query(
        `select * from public.service_pulse_agreement(now() - interval '90 days', $1)
         order by teacher_reading`,
        [ENGINE],
      ),
    );
    // Counted by pair, so that the answer stays small whatever the number of checks.
    expect(pairs).toEqual([
      {
        teacher_reading: 'fluent',
        machine_reading: 'fluent',
        teacher_english: 'sentences',
        machine_english: 'sentences',
        checks: 2,
      },
      {
        teacher_reading: 'needs_support',
        machine_reading: 'hesitant',
        teacher_english: 'words',
        machine_english: 'no_response',
        checks: 1,
      },
    ]);
  });
});

describe('removing transcripts with the recordings', () => {
  it('keeps no transcript of a score that arrives after its recording was removed', async () => {
    const recorded = await check({ receivedDaysAgo: 31 });
    await database.as(service, (query) =>
      query('select public.service_mark_pulse_audio_removed($1)', [[recorded.path]]),
    );
    // A long run that started before the removal finishes afterwards.
    await score(recorded.id);
    const [row] = await database.query<{
      transcript: unknown;
      transcript_deleted_at: string | null;
    }>('select transcript, transcript_deleted_at from public.pulse_scores where check_id = $1', [
      recorded.id,
    ]);
    expect(row?.transcript).toBeNull();
    expect(row?.transcript_deleted_at).not.toBeNull();
  });

  it('removes a check’s transcript when its recording is deleted, and keeps the measures', async () => {
    const recorded = await check({ receivedDaysAgo: 31 });
    await score(recorded.id);
    const [count] = await database.as(service, (query) =>
      query<{ removed: number }>('select public.service_mark_pulse_audio_removed($1) as removed', [
        [recorded.path],
      ]),
    );
    expect(count?.removed).toBe(1);
    const [row] = await database.query<{
      transcript: unknown;
      transcript_deleted_at: string | null;
      wcpm: number;
    }>(
      'select transcript, transcript_deleted_at, wcpm from public.pulse_scores where check_id = $1',
      [recorded.id],
    );
    expect(row?.transcript).toBeNull();
    expect(row?.transcript_deleted_at).not.toBeNull();
    expect(row?.wcpm).toBeCloseTo(31.2);

    // A rescore while the recording is still there brings a transcript back; afterwards it does not.
    const later = await check();
    await score(later.id);
    const [before] = await database.query<{ scored_at: string }>(
      'select scored_at::text from public.pulse_scores where check_id = $1',
      [later.id],
    );
    await database.as(service, (query) =>
      query('select public.service_mark_pulse_audio_removed($1)', [[later.path]]),
    );
    const [after] = await database.query<{ scored_at: string; transcript: unknown }>(
      'select scored_at::text, transcript from public.pulse_scores where check_id = $1',
      [later.id],
    );
    expect(after).toEqual({ scored_at: before?.scored_at, transcript: null });
  });
});
