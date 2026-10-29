import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { classifyFailure } from '@/features/offline/sync-errors';
import type { AppSupabaseClient } from '@/lib/supabase';
import {
  audioPathOf,
  pulseCheckChange,
  pulseCycleKey,
  sendPulseAbsence,
  sendPulseCheck,
  type PulseCheckChange,
  type PulseCycleView,
  type RecordedCheckChange,
} from './pulse-change';

const CLASS_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CHECK_ID = '2dae9e77-8e80-4b9e-9c6d-4b5c3a7f8e9d';

const change: RecordedCheckChange = {
  mode: 'recorded',
  checkId: CHECK_ID,
  sampleId: '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b',
  classSectionId: CLASS_ID,
  studentId: '1c9d8d66-7d7f-4a8d-8b5c-3a4b2f6e7d8c',
  attempt: 1,
  itemCode: 'hi-g2-p04',
  promptCode: 'en-g2-s07',
  item: {
    reading: { code: 'hi-g2-p04' },
    speaking: { code: 'en-g2-s07' },
    shown: [
      { level: 'passage', atMs: 0 },
      { level: 'english', atMs: 38_500 },
    ],
    restarts: 0,
  },
  fileId: '3ebfaf88-9f91-4caf-8d7e-5c6d4b8a9fae',
  contentType: 'audio/webm',
  durationMs: 58_200,
  noiseDbfs: -52.5,
  readingLevel: 'hesitant',
  englishLevel: 'words',
  clarity: 'clear',
  classroom: 'normal',
  tags: ['missed_words'],
  recordedAt: '2026-10-18T10:15:00.000Z',
  childName: 'Asha',
  classLabel: { grade: 2, section: 'A' },
};

const adapted: PulseCheckChange = {
  mode: 'adapted',
  checkId: '4fc0b099-a0a2-4dba-9e8f-6d7e5c9b0aaf',
  sampleId: change.sampleId,
  classSectionId: CLASS_ID,
  studentId: change.studentId,
  readingLevel: 'hesitant',
  englishLevel: 'no_response',
  tags: ['needed_prompting'],
  recordedAt: '2026-10-18T10:20:00.000Z',
  childName: 'Asha',
  classLabel: { grade: 2, section: 'A' },
};

interface StorageAnswer {
  error: Record<string, unknown> | null;
}

function fakeSupabase(upload: StorageAnswer, upsert: { error: unknown } = { error: null }) {
  const calls = {
    upload: vi.fn<(path: string, body: Blob, options: unknown) => void>(),
    upsert: vi.fn<(table: string, values: unknown, options: unknown) => void>(),
  };
  const client = {
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe('pulse-audio');
        return {
          upload: (path: string, body: Blob, options: unknown) => {
            calls.upload(path, body, options);
            return Promise.resolve({ data: upload.error ? null : { path }, error: upload.error });
          },
        };
      },
    },
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => {
        calls.upsert(table, values, options);
        return Promise.resolve(upsert);
      },
    }),
  };
  return { client: client as unknown as AppSupabaseClient, calls };
}

const audio = new Blob(['voice'], { type: 'audio/webm' });
const readFile = () => Promise.resolve(audio);

describe('sending a Pulse check', () => {
  it('uploads the recording under the check id, then records the check once', async () => {
    const { client, calls } = fakeSupabase({ error: null });
    await expect(sendPulseCheck(change, client, readFile)).resolves.toEqual({ checkId: CHECK_ID });

    expect(audioPathOf(change)).toBe(`${CLASS_ID}/${change.sampleId}/${CHECK_ID}.webm`);
    expect(calls.upload).toHaveBeenCalledWith(
      `${CLASS_ID}/${change.sampleId}/${CHECK_ID}.webm`,
      audio,
      {
        contentType: 'audio/webm',
        upsert: false,
        cacheControl: '3600',
      },
    );
    const [table, values, options] = calls.upsert.mock.calls[0]!;
    expect(table).toBe('pulse_checks');
    expect(values).toEqual({
      id: CHECK_ID,
      sample_id: change.sampleId,
      class_section_id: CLASS_ID,
      student_id: change.studentId,
      mode: 'recorded',
      reading_level: 'hesitant',
      english_level: 'words',
      tags: ['missed_words'],
      recorded_at: change.recordedAt,
      attempt: 1,
      item_code: 'hi-g2-p04',
      prompt_code: 'en-g2-s07',
      item: change.item,
      audio_path: `${CLASS_ID}/${change.sampleId}/${CHECK_ID}.webm`,
      audio_type: 'audio/webm',
      audio_bytes: audio.size,
      duration_ms: 58_200,
      noise_dbfs: -52.5,
      clarity: 'clear',
      classroom: 'normal',
    });
    expect(options).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('carries on when an earlier attempt already uploaded the recording', async () => {
    const { client, calls } = fakeSupabase({
      error: {
        name: 'StorageApiError',
        message: 'The resource already exists',
        status: 409,
        statusCode: '409',
      },
    });
    await sendPulseCheck(change, client, readFile);
    expect(calls.upsert).toHaveBeenCalledTimes(1);
  });

  it('turns upload failures into retries, sign-in waits or refusals', async () => {
    const failure = async (error: Record<string, unknown>) => {
      const { client, calls } = fakeSupabase({ error });
      const result = await sendPulseCheck(change, client, readFile).then(
        () => null,
        (thrown: unknown) => classifyFailure(thrown),
      );
      expect(calls.upsert).not.toHaveBeenCalled();
      return result;
    };

    expect(
      await failure({ name: 'StorageUnknownError', message: 'Failed to fetch' }),
    ).toMatchObject({
      kind: 'retry',
      code: 'network',
    });
    expect(
      await failure({
        name: 'StorageApiError',
        message: 'Bad gateway',
        status: 502,
        statusCode: '502',
      }),
    ).toMatchObject({ kind: 'retry' });
    expect(
      await failure({
        name: 'StorageApiError',
        message: 'jwt expired',
        status: 400,
        statusCode: '401',
      }),
    ).toMatchObject({ kind: 'reauthenticate' });
    expect(
      await failure({
        name: 'StorageApiError',
        message: 'new row violates row-level security policy',
        status: 400,
        statusCode: '403',
      }),
    ).toMatchObject({ kind: 'reject', code: 'storage_403' });
    expect(
      await failure({
        name: 'StorageApiError',
        message: 'Payload too large',
        status: 413,
        statusCode: '413',
      }),
    ).toMatchObject({ kind: 'reject', code: 'storage_413' });
  });

  it('reports a refused check as the database answered', async () => {
    const { client } = fakeSupabase(
      { error: null },
      { error: { code: '23514', message: 'The recording time is outside the check period.' } },
    );
    const thrown = await sendPulseCheck(change, client, readFile).catch((error: unknown) => error);
    expect(classifyFailure(thrown)).toMatchObject({ kind: 'reject', code: '23514' });
  });

  it('carries the recording as a file that is removed once sent', () => {
    expect(pulseCheckChange.files?.(change)).toEqual([change.fileId]);
    expect(pulseCheckChange.timeoutMs).toBeGreaterThan(45_000);
    expect(pulseCheckChange.schema.safeParse(change).success).toBe(true);
    expect(pulseCheckChange.schema.safeParse({ ...change, durationMs: 90_000 }).success).toBe(
      false,
    );
    expect(pulseCheckChange.schema.safeParse({ ...change, promptCode: 'EN G2' }).success).toBe(
      false,
    );
    expect(pulseCheckChange.schema.safeParse({ ...change, englishLevel: 'fluent' }).success).toBe(
      false,
    );
    const withoutPrompt: Record<string, unknown> = { ...change };
    Reflect.deleteProperty(withoutPrompt, 'promptCode');
    expect(pulseCheckChange.schema.safeParse(withoutPrompt).success).toBe(false);
  });

  it('records an adapted check without any recording', async () => {
    const { client, calls } = fakeSupabase({ error: null });
    const readNothing = vi.fn(readFile);
    await expect(sendPulseCheck(adapted, client, readNothing)).resolves.toEqual({
      checkId: adapted.checkId,
    });

    expect(readNothing).not.toHaveBeenCalled();
    expect(calls.upload).not.toHaveBeenCalled();
    expect(calls.upsert).toHaveBeenCalledWith(
      'pulse_checks',
      {
        id: adapted.checkId,
        sample_id: adapted.sampleId,
        class_section_id: CLASS_ID,
        student_id: adapted.studentId,
        mode: 'adapted',
        reading_level: 'hesitant',
        english_level: 'no_response',
        tags: ['needed_prompting'],
        recorded_at: adapted.recordedAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    expect(pulseCheckChange.files?.(adapted)).toEqual([]);
    expect(pulseCheckChange.schema.safeParse(adapted).success).toBe(true);
  });

  it('shows a sent check in the cached cycle once, whatever its kind', () => {
    const queryClient = new QueryClient();
    const view: PulseCycleView = {
      cycle: null,
      children: [
        {
          sampleId: change.sampleId,
          studentId: change.studentId,
          name: 'Asha',
          studentCode: 'S-1',
          adapted: false,
          week: 3,
          opensOn: '2026-10-15',
          dueOn: '2026-10-21',
          replacesSampleId: null,
          replacedAt: null,
          replacementReason: null,
          checks: [],
          absences: [],
        },
      ],
      seenItems: {},
      weeks: [],
    };
    queryClient.setQueryData(pulseCycleKey(CLASS_ID), view);

    pulseCheckChange.onSent?.(change, { checkId: CHECK_ID }, queryClient);
    pulseCheckChange.onSent?.(change, { checkId: CHECK_ID }, queryClient);
    pulseCheckChange.onSent?.(adapted, { checkId: adapted.checkId }, queryClient);

    const checks = queryClient.getQueryData<PulseCycleView>(pulseCycleKey(CLASS_ID))?.children[0]
      ?.checks;
    expect(checks).toEqual([
      {
        id: CHECK_ID,
        attempt: 1,
        mode: 'recorded',
        classroom: 'normal',
        itemCode: 'hi-g2-p04',
        promptCode: 'en-g2-s07',
        recordedAt: change.recordedAt,
      },
      {
        id: adapted.checkId,
        attempt: 1,
        mode: 'adapted',
        classroom: null,
        itemCode: null,
        promptCode: null,
        recordedAt: adapted.recordedAt,
      },
    ]);
  });
});

describe('sending a Pulse absence', () => {
  it('records the day once, ignoring a resend', async () => {
    const { client, calls } = fakeSupabase({ error: null });
    await sendPulseAbsence(
      {
        sampleId: change.sampleId,
        classSectionId: CLASS_ID,
        date: '2026-10-18',
        childName: 'Asha',
        classLabel: { grade: 2, section: 'A' },
      },
      client,
    );
    expect(calls.upsert).toHaveBeenCalledWith(
      'pulse_absences',
      { sample_id: change.sampleId, absent_on: '2026-10-18' },
      { onConflict: 'sample_id,absent_on', ignoreDuplicates: true },
    );
  });
});
