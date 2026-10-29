import { describe, expect, it } from 'vitest';
import {
  handleRetention,
  RETENTION_BATCH,
  RETENTION_ROUNDS,
} from '../../../supabase/functions/pulse-retention/handler.ts';
import type {
  DueRecording,
  RetentionKind,
  RetentionServices,
} from '../../../supabase/functions/_shared/services.ts';

const TOKEN = 'a'.repeat(64);

/** Recordings due for removal, which disappear from the list once removed and marked. */
class FakeRetention implements RetentionServices {
  removed: string[] = [];
  marked: string[] = [];
  notesRemoved: string[] = [];
  notesMarked: string[] = [];

  constructor(
    public due: DueRecording[],
    public notes: DueRecording[] = [],
  ) {}

  jobTokenIsValid(token: string) {
    return Promise.resolve(token === TOKEN);
  }

  dueRecordings(kind: RetentionKind, limit: number) {
    return Promise.resolve((kind === 'pulse' ? this.due : this.notes).slice(0, limit));
  }

  removeFiles(kind: RetentionKind, paths: string[]) {
    if (kind === 'pulse') {
      this.removed.push(...paths);
      this.due = this.due.filter((recording) => !paths.includes(recording.path));
    } else {
      this.notesRemoved.push(...paths);
      this.notes = this.notes.filter((recording) => !paths.includes(recording.path));
    }
    return Promise.resolve();
  }

  markRemoved(kind: RetentionKind, paths: string[]) {
    (kind === 'pulse' ? this.marked : this.notesMarked).push(...paths);
    return Promise.resolve();
  }
}

describe('Pulse recording retention', () => {
  it('refuses callers without the job token', async () => {
    const services = new FakeRetention([{ path: 'a/b.webm', reason: 'expired' }]);
    expect(await handleRetention(null, services)).toMatchObject({ status: 403 });
    expect(await handleRetention('b'.repeat(64), services)).toMatchObject({ status: 403 });
    expect(services.removed).toEqual([]);
  });

  it('deletes expired and unclaimed recordings, and marks only the expired checks', async () => {
    const services = new FakeRetention([
      { path: 'class/one.webm', reason: 'expired' },
      { path: 'class/two.m4a', reason: 'unclaimed' },
    ]);
    expect(await handleRetention(TOKEN, services)).toEqual({
      status: 200,
      body: { expired: 1, unclaimed: 1, notes: { expired: 0, unclaimed: 0 } },
    });
    expect(services.removed).toEqual(['class/one.webm', 'class/two.m4a']);
    expect(services.marked).toEqual(['class/one.webm']);
  });

  it("removes the CRPs' voice notes by the same rules, from their own bucket", async () => {
    const services = new FakeRetention(
      [],
      [
        { path: 'visit/note.webm', reason: 'expired' },
        { path: 'visit/stray.webm', reason: 'unclaimed' },
      ],
    );
    expect(await handleRetention(TOKEN, services)).toMatchObject({
      body: { expired: 0, unclaimed: 0, notes: { expired: 1, unclaimed: 1 } },
    });
    expect(services.notesRemoved).toEqual(['visit/note.webm', 'visit/stray.webm']);
    expect(services.notesMarked).toEqual(['visit/note.webm']);
    expect(services.removed).toEqual([]);
  });

  it('works through large backlogs in rounds, leaving the rest for the next day', async () => {
    const backlog = Array.from(
      { length: RETENTION_BATCH * (RETENTION_ROUNDS + 1) },
      (_, index) => ({
        path: `class/${String(index)}.webm`,
        reason: 'expired' as const,
      }),
    );
    const services = new FakeRetention(backlog);
    expect(await handleRetention(TOKEN, services)).toMatchObject({
      body: { expired: RETENTION_BATCH * RETENTION_ROUNDS },
    });
    expect(services.due).toHaveLength(RETENTION_BATCH);
  });

  it('leaves the checks unmarked when the files could not be deleted', async () => {
    const services = new FakeRetention([{ path: 'class/one.webm', reason: 'expired' }]);
    services.removeFiles = () => Promise.reject(new Error('Storage is unavailable'));
    await expect(handleRetention(TOKEN, services)).rejects.toThrow('Storage is unavailable');
    expect(services.marked).toEqual([]);
  });
});
