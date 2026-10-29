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

/** A visit to class A1 Grade 1 by CRP A, taking place today or planned. */
async function visit(status: 'done' | 'planned' = 'done'): Promise<string> {
  const id = randomUUID();
  const today = await database.query<{ today: string }>('select private.today()::text as today');
  await database.as(asUser(scenario.staff.crpA), (query) =>
    query('select public.save_visit($1::jsonb)', [
      JSON.stringify({
        id,
        change_id: randomUUID(),
        class_section_id: scenario.classA1Grade1Id,
        status,
        visited_on: status === 'done' ? today[0]?.today : null,
        planned_on: status === 'planned' ? today[0]?.today : null,
        started_at: status === 'done' ? new Date().toISOString() : null,
        observations: [],
        moments: [],
        rechecks: [],
      }),
    ]),
  );
  return id;
}

function upload(userId: string, path: string, size = 120_000, mimetype = 'audio/webm') {
  return database.as(asUser(userId), (query) =>
    query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('visit-notes', $1, auth.uid()::text, $2::jsonb)`,
      [path, JSON.stringify({ size, mimetype, eTag: `"${randomUUID()}"` })],
    ),
  );
}

function keepNote(userId: string, visitId: string, noteId: string, extension = 'webm') {
  return database.as(asUser(userId), (query) =>
    query<{ recorded_by: string; audio_bytes: number; transcript: string | null }>(
      `insert into public.visit_notes (visit_id, note_id, audio_path, audio_type, audio_bytes,
         duration_ms, language, recorded_at)
       values ($1, $2, $3, 'audio/webm', 1, 95000, 'hi', now())
       on conflict (visit_id) do update set note_id = excluded.note_id,
         audio_path = excluded.audio_path, duration_ms = excluded.duration_ms
       returning recorded_by, audio_bytes, transcript`,
      [visitId, noteId, `${visitId}/${noteId}.${extension}`],
    ),
  );
}

async function recordedNote(): Promise<{ visitId: string; path: string }> {
  const visitId = await visit();
  const noteId = randomUUID();
  const path = `${visitId}/${noteId}.webm`;
  await upload(scenario.staff.crpA, path);
  await keepNote(scenario.staff.crpA, visitId, noteId);
  return { visitId, path };
}

describe('uploading a note', () => {
  it("accepts a file only for the CRP's own visit that took place", async () => {
    const visitId = await visit();
    await upload(scenario.staff.crpA, `${visitId}/${randomUUID()}.webm`);
    expect(await errorCodeOf(upload(scenario.staff.crpB, `${visitId}/${randomUUID()}.webm`))).toBe(
      '42501',
    );
    expect(
      await errorCodeOf(upload(scenario.staff.teacherA1, `${visitId}/${randomUUID()}.webm`)),
    ).toBe('42501');
    const planned = await visit('planned');
    expect(await errorCodeOf(upload(scenario.staff.crpA, `${planned}/${randomUUID()}.webm`))).toBe(
      '42501',
    );
    expect(await errorCodeOf(upload(scenario.staff.crpA, `${visitId}/note.webm`))).toBe('42501');
  });
});

describe('keeping a note', () => {
  it('takes the size from storage and stamps who recorded it', async () => {
    const visitId = await visit();
    const noteId = randomUUID();
    await upload(scenario.staff.crpA, `${visitId}/${noteId}.webm`, 98_765);
    const [row] = await keepNote(scenario.staff.crpA, visitId, noteId);
    expect(row).toEqual({
      recorded_by: scenario.staff.crpA,
      audio_bytes: 98_765,
      transcript: null,
    });
  });

  it('takes the type from storage, and refuses a file name that does not match it', async () => {
    const visitId = await visit();
    const noteId = randomUUID();
    await upload(scenario.staff.crpA, `${visitId}/${noteId}.ogg`, 5_000, 'audio/ogg');
    await keepNote(scenario.staff.crpA, visitId, noteId, 'ogg');
    const [row] = await database.query<{ audio_type: string }>(
      'select audio_type from public.visit_notes where visit_id = $1',
      [visitId],
    );
    expect(row?.audio_type).toBe('audio/ogg');

    const withCodec = randomUUID();
    await upload(
      scenario.staff.crpA,
      `${visitId}/${withCodec}.webm`,
      5_000,
      'audio/webm;codecs=opus',
    );
    await keepNote(scenario.staff.crpA, visitId, withCodec);

    const mismatched = randomUUID();
    await upload(scenario.staff.crpA, `${visitId}/${mismatched}.webm`, 5_000, 'audio/ogg');
    expect(await errorCodeOf(keepNote(scenario.staff.crpA, visitId, mismatched))).toBe('23514');
  });

  it('refuses a missing file, a file under another name, and a file of someone else', async () => {
    const visitId = await visit();
    expect(await errorCodeOf(keepNote(scenario.staff.crpA, visitId, randomUUID()))).toBe('23514');
    const noteId = randomUUID();
    await upload(scenario.staff.crpA, `${visitId}/${noteId}.webm`);
    expect(await errorCodeOf(keepNote(scenario.staff.crpA, visitId, noteId, 'ogg'))).toBe('23514');
    // A file stored by the owner for this visit, claimed by another account: refused.
    expect(await errorCodeOf(keepNote(scenario.staff.crpB, visitId, noteId))).toBe('42501');
  });

  it('is read only by the CRP who made the visit', async () => {
    const { path } = await recordedNote();
    const read = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query<{ audio_path: string }>('select audio_path from public.visit_notes'),
      );
    const listen = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query<{ name: string }>("select name from storage.objects where bucket_id = 'visit-notes'"),
      );
    expect(await read(scenario.staff.crpA)).toEqual([{ audio_path: path }]);
    expect(await listen(scenario.staff.crpA)).toEqual([{ name: path }]);
    // A second CRP of the same cluster reads the visit, but not the note made about it.
    const crpA2 = await provisionStaff(database.query, {
      fullName: 'CRP A2',
      role: 'crp',
      scopeId: scenario.clusterAId,
    });
    for (const other of [
      crpA2,
      scenario.staff.teacherA1,
      scenario.staff.teacherA1Colleague,
      scenario.staff.crpB,
      scenario.staff.blockOfficer,
    ]) {
      expect(await read(other)).toEqual([]);
      expect(await listen(other)).toEqual([]);
    }
  });

  it('starts without a transcript when recorded again, and never takes one from the app', async () => {
    const { visitId, path } = await recordedNote();
    await database.as(service, (query) =>
      query('select public.service_save_visit_note_transcript($1, $2, $3, $4)', [
        visitId,
        path,
        'बच्चे जोड़ी में पढ़ रहे थे',
        'pulse-engine 1.0 (test)',
      ]),
    );
    // The app cannot write a transcript of its own.
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query("update public.visit_notes set transcript = 'made up' where visit_id = $1", [visitId]),
    );
    const transcript = () =>
      database.query<{ transcript: string | null }>(
        'select transcript from public.visit_notes where visit_id = $1',
        [visitId],
      );
    expect(await transcript()).toEqual([{ transcript: 'बच्चे जोड़ी में पढ़ रहे थे' }]);

    const again = randomUUID();
    await upload(scenario.staff.crpA, `${visitId}/${again}.webm`);
    await keepNote(scenario.staff.crpA, visitId, again);
    expect(await transcript()).toEqual([{ transcript: null }]);
    // A transcript of the earlier file is not saved over the new note.
    const [saved] = await database.as(service, (query) =>
      query<{ saved: boolean }>(
        'select public.service_save_visit_note_transcript($1, $2, $3, $4) as saved',
        [visitId, path, 'old', 'pulse-engine 1.0 (test)'],
      ),
    );
    expect(saved?.saved).toBe(false);
  });
});

describe('transcription and retention', () => {
  it('lists notes to transcribe until three attempts by the same engine', async () => {
    const { visitId, path } = await recordedNote();
    const due = (engine: string | null) =>
      database.as(service, (query) =>
        query<{ visit_id: string }>(
          'select visit_id from public.service_visit_notes_to_transcribe(10, $1)',
          [engine],
        ),
      );
    const attempt = (engine: string) =>
      database
        .as(service, (query) =>
          query<{ attempts: number }>(
            'select public.service_record_visit_note_failure($1, $2, $3) as attempts',
            [visitId, path, engine],
          ),
        )
        .then((rows) => rows[0]?.attempts);
    expect(await due('pulse-engine 1.0')).toEqual([{ visit_id: visitId }]);
    for (let count = 1; count <= 3; count += 1) {
      expect(await attempt('pulse-engine 1.0')).toBe(count);
    }
    expect(await due('pulse-engine 1.0')).toEqual([]);
    expect(await due(null)).toEqual([]);
    // A new engine tries again, counting from one.
    expect(await due('pulse-engine 1.1')).toEqual([{ visit_id: visitId }]);
    expect(await attempt('pulse-engine 1.1')).toBe(1);

    // A saved transcript clears the attempts.
    await database.as(service, (query) =>
      query('select public.service_save_visit_note_transcript($1, $2, $3, $4)', [
        visitId,
        path,
        'नोट',
        'pulse-engine 1.1',
      ]),
    );
    const [row] = await database.query<{ transcript_failures: number; engine: string | null }>(
      `select transcript_failures, transcript_failed_engine as engine from public.visit_notes
       where visit_id = $1`,
      [visitId],
    );
    expect(row).toEqual({ transcript_failures: 0, engine: null });
  });

  it('removes notes after 30 days with their transcripts, and uploads no note claimed', async () => {
    const { visitId, path } = await recordedNote();
    await database.as(service, (query) =>
      query('select public.service_save_visit_note_transcript($1, $2, $3, $4)', [
        visitId,
        path,
        'नोट',
        'pulse-engine 1.0 (test)',
      ]),
    );
    const stray = `${visitId}/${randomUUID()}.webm`;
    await upload(scenario.staff.crpA, stray);
    await database.query(
      `update storage.objects set created_at = now() - interval '3 days' where name = $1`,
      [stray],
    );
    await database.query(
      `update public.visit_notes set received_at = now() - interval '31 days' where visit_id = $1`,
      [visitId],
    );
    const due = await database.as(service, (query) =>
      query<{ path: string; reason: string }>(
        'select path, reason from public.service_visit_notes_to_remove(10) order by reason',
      ),
    );
    expect(due).toEqual([
      { path, reason: 'expired' },
      { path: stray, reason: 'unclaimed' },
    ]);
    await database.as(service, (query) =>
      query('select public.service_mark_visit_notes_removed($1)', [[path]]),
    );
    const [row] = await database.query<{ transcript: string | null; removed: boolean }>(
      `select transcript, audio_deleted_at is not null as removed from public.visit_notes
       where visit_id = $1`,
      [visitId],
    );
    expect(row).toEqual({ transcript: null, removed: true });
  });

  it('keeps the transcription and retention functions for the secret key', async () => {
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.crpA), (query) =>
          query('select * from public.service_visit_notes_to_transcribe(10)'),
        ),
      ),
    ).toBe('42501');
  });
});
