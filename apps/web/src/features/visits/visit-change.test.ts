import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import type { AppSupabaseClient } from '@/lib/supabase';
import { finishTime } from './visit-builders';
import { withDrafts } from './visit-api';
import {
  attachNote,
  CLOSED_VISIT,
  discardDraft,
  draftOf,
  draftSaved,
  feedbackIsComplete,
  nextVisitChange,
  noteUploaded,
  notePathOf,
  reconcileDrafts,
  sendVisit,
  STALE_VISIT,
  visitPayload,
  visitSaveChange,
  visitSentOf,
  type StoredVisit,
  type Visit,
  type VoiceNote,
} from './visit-change';

const MOMENT = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const LABEL = { grade: 2, section: 'A' };

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: '0f1e2d3c-4b5a-4968-8776-655443322110',
    classSectionId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    schoolId: '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9',
    crpId: '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f9a0',
    teacherId: null,
    status: 'done',
    plannedOn: null,
    visitedOn: '2026-10-21',
    startedAt: '2026-10-21T04:30:00.000Z',
    finishedAt: null,
    lessonNote: '  Sarangi, lesson 6  ',
    followsVisitId: null,
    followUpResult: null,
    requestId: null,
    observations: [{ itemCode: 'every-child-reads', position: 1, answer: 'yes', note: '' }],
    moments: [{ id: MOMENT, tagCode: 'all-reading', atSeconds: 120, note: '' }],
    rechecks: [],
    feedback: {
      strength: 'Every child read a line alone.',
      evidence: [{ moment: MOMENT }, { item: 'every-child-reads' }, { item: 'gone' }],
      practiceCode: 'paired-reading',
      changeNote: '',
      technique: 'Pairs for ten minutes daily.',
      demoGiven: true,
      planNote: '',
      checkBackOn: '2026-11-04',
      language: 'hi',
      agreedAt: null,
    },
    ...overrides,
  };
}

describe('the visit as the server takes it', () => {
  it('sends complete feedback, without evidence of things no longer in the visit', () => {
    const queryClient = new QueryClient();
    const change = nextVisitChange(queryClient, visit(), null, LABEL);
    const payload = visitPayload(change) as Record<string, unknown>;
    expect(payload).toMatchObject({
      change_id: change.changeId,
      base_revision: null,
      supersedes: [],
      lesson_note: 'Sarangi, lesson 6',
      planned_on: null,
      visited_on: '2026-10-21',
    });
    expect((payload.feedback as { evidence: unknown }).evidence).toEqual([
      { moment: MOMENT },
      { item: 'every-child-reads' },
    ]);
  });

  it('cites only focus items that were seen', () => {
    const base = visit();
    const payload = visitPayload(
      nextVisitChange(
        new QueryClient(),
        {
          ...base,
          observations: [{ itemCode: 'every-child-reads', position: 1, answer: 'no', note: '' }],
        },
        null,
        LABEL,
      ),
    ) as { feedback: { evidence: unknown } };
    expect(payload.feedback.evidence).toEqual([{ moment: MOMENT }]);
  });

  it('leaves out feedback still being drafted, so that the server keeps what was agreed', () => {
    const base = visit();
    const drafts: Visit[] = [
      { ...base, feedback: { ...base.feedback!, strength: '  ' } },
      { ...base, feedback: { ...base.feedback!, practiceCode: null } },
      { ...base, feedback: { ...base.feedback!, checkBackOn: '2026-10-22' } },
      { ...base, feedback: { ...base.feedback!, checkBackOn: '2026-12-31' } },
    ];
    for (const draft of drafts) {
      expect(feedbackIsComplete(draft)).toBe(false);
      const change = nextVisitChange(new QueryClient(), draft, null, LABEL);
      expect(visitPayload(change)).not.toHaveProperty('feedback');
    }
    expect(feedbackIsComplete(base)).toBe(true);
    // A visit without feedback says so.
    const none = nextVisitChange(new QueryClient(), visit({ feedback: null }), null, LABEL);
    expect(visitPayload(none)).toHaveProperty('feedback', null);
  });

  it('sends a planned visit without the details of one that took place', () => {
    const planned = visit({
      status: 'planned',
      plannedOn: '2026-10-23',
      visitedOn: null,
      startedAt: null,
      rechecks: [
        {
          checkId: '3c4d5e6f-7081-4293-a4b5-c6d7e8f9a0b1',
          studentId: '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c2',
          readingLevel: 'fluent',
          englishLevel: 'words',
          note: '',
        },
      ],
    });
    const payload = visitPayload(
      nextVisitChange(new QueryClient(), planned, null, LABEL),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: 'planned',
      planned_on: '2026-10-23',
      visited_on: null,
      rechecks: [],
      feedback: null,
    });
  });
});

describe('the working copy on the device', () => {
  it('builds every save on the revision it started from and the saves still unanswered', () => {
    const queryClient = new QueryClient();
    const first = nextVisitChange(queryClient, visit(), 3, LABEL);
    expect(first).toMatchObject({ baseRevision: 3, supersedes: [] });
    const second = nextVisitChange(queryClient, visit({ lessonNote: 'p. 42' }), 3, LABEL);
    expect(second.supersedes).toEqual([first.changeId]);
    expect(draftOf(queryClient, first.visit.id)?.visit.lessonNote).toBe('p. 42');

    // The first save is written: the draft now starts from its revision; the second is still due.
    draftSaved(queryClient, first, { revision: 4, noteMissing: false });
    expect(draftOf(queryClient, first.visit.id)).toMatchObject({
      baseRevision: 4,
      pendingChanges: [second.changeId],
    });
    const third = nextVisitChange(queryClient, visit(), 4, LABEL);
    expect(third).toMatchObject({ baseRevision: 4, supersedes: [second.changeId] });

    discardDraft(queryClient, first.visit.id);
    expect(draftOf(queryClient, first.visit.id)).toBeUndefined();
  });

  it('shows a sent visit in the list of the cluster at once', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['crp-visits'], []);
    const change = nextVisitChange(queryClient, visit(), null, LABEL);
    visitSaveChange.onSent?.(change, { revision: 1, noteMissing: false }, queryClient);
    expect(queryClient.getQueryData<{ id: string; revision: number }[]>(['crp-visits'])).toEqual([
      expect.objectContaining({
        id: change.visit.id,
        revision: 1,
        clientChangeId: change.changeId,
      }),
    ]);
    // The server holds all of it now, so the phone's copy gives way.
    expect(draftOf(queryClient, change.visit.id)).toBeUndefined();
    // A save sent by an earlier version answered with the revision alone.
    expect(visitSentOf(3)).toEqual({ revision: 3, noteMissing: false });
  });

  it('keeps feedback still being drafted on the phone after the rest was sent', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['crp-visits'], []);
    const base = visit();
    const drafting = { ...base, feedback: { ...base.feedback!, strength: '' } };
    const change = nextVisitChange(queryClient, drafting, null, LABEL);
    visitSaveChange.onSent?.(change, { revision: 1, noteMissing: false }, queryClient);
    expect(draftOf(queryClient, base.id)?.visit.feedback?.strength).toBe('');
    expect(draftOf(queryClient, base.id)?.pendingChanges).toEqual([]);
  });

  it('follows saves sent while no page was open, and gives way to another device', () => {
    const queryClient = new QueryClient();
    const first = nextVisitChange(queryClient, visit(), 2, LABEL);
    const second = nextVisitChange(queryClient, visit({ lessonNote: 'p. 43' }), 2, LABEL);
    const held = (revision: number, clientChangeId: string | null): StoredVisit => ({
      ...visit({ lessonNote: 'p. 43' }),
      revision,
      clientChangeId,
    });
    // The service worker sent the first save: the second still waits, from the new revision.
    reconcileDrafts(queryClient, [held(3, first.changeId)]);
    expect(draftOf(queryClient, first.visit.id)).toMatchObject({
      baseRevision: 3,
      pendingChanges: [second.changeId],
    });
    // Then the second: nothing is left to send.
    queryClient.setQueryData(['crp-visits'], [held(4, second.changeId)]);
    reconcileDrafts(queryClient, [held(4, second.changeId)]);
    expect(draftOf(queryClient, first.visit.id)).toBeUndefined();

    // A copy with nothing to send that another device has changed since is dropped.
    const quiet = new QueryClient();
    const own = nextVisitChange(
      quiet,
      visit({ feedback: { ...visit().feedback!, strength: '' } }),
      5,
      LABEL,
    );
    draftSaved(quiet, own, { revision: 6, noteMissing: false });
    expect(draftOf(quiet, own.visit.id)).toBeDefined();
    reconcileDrafts(quiet, [held(7, crypto.randomUUID())]);
    expect(draftOf(quiet, own.visit.id)).toBeUndefined();
  });

  it('shows visits planned or started on the phone with those of the server', () => {
    const queryClient = new QueryClient();
    const stored: StoredVisit = {
      ...visit({ lessonNote: 'server' }),
      revision: 1,
      clientChangeId: null,
    };
    const fresh = visit({ id: '9f8e7d6c-5b4a-4398-8776-655443322110', status: 'planned' });
    nextVisitChange(queryClient, visit({ lessonNote: 'phone' }), 1, LABEL);
    nextVisitChange(queryClient, fresh, null, null);
    const drafts = [draftOf(queryClient, stored.id), draftOf(queryClient, fresh.id)].filter(
      (draft) => draft !== undefined,
    );
    const shown = withDrafts([stored], drafts);
    expect(shown.map((entry) => [entry.id, entry.lessonNote])).toEqual([
      [stored.id, 'phone'],
      [fresh.id, fresh.lessonNote],
    ]);
  });

  it('lets go of a voice note once the server holds it', () => {
    const queryClient = new QueryClient();
    const base = visit();
    queryClient.setQueryData(['crp-visits'], [{ ...base, revision: 2, clientChangeId: null }]);
    const note: VoiceNote = {
      noteId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
      fileId: '6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c',
      contentType: 'audio/webm',
      durationMs: 40_000,
      language: 'hi',
      recordedAt: '2026-10-21T05:00:00.000Z',
    };
    attachNote(queryClient, base, 2, note);
    noteUploaded(queryClient, base.id, 'some/other.webm');
    expect(draftOf(queryClient, base.id)?.pendingNote).toEqual(note);
    noteUploaded(queryClient, base.id, notePathOf(base.id, note));
    expect(draftOf(queryClient, base.id)).toBeUndefined();
  });
});

describe('the end of a visit', () => {
  it('is now, but never more than twelve hours after the start', () => {
    const start = '2026-10-21T04:30:00.000Z';
    const at = (iso: string) => Date.parse(iso);
    expect(finishTime(start, at('2026-10-21T05:30:00.000Z'))).toBe('2026-10-21T05:30:00.000Z');
    expect(finishTime(start, at('2026-10-22T09:00:00.000Z'))).toBe('2026-10-21T16:30:00.000Z');
    // A phone clock behind the start does not end the visit before it began.
    expect(finishTime(start, at('2026-10-21T04:00:00.000Z'))).toBe(start);
  });
});

describe('sending a visit', () => {
  function supabaseAnswering(answer: { data: unknown; error: unknown }) {
    const rpc = vi.fn().mockResolvedValue(answer);
    return { client: { rpc } as unknown as AppSupabaseClient, rpc };
  }

  it('returns the new revision', async () => {
    const { client, rpc } = supabaseAnswering({ data: 7, error: null });
    const change = nextVisitChange(new QueryClient(), visit(), 6, LABEL);
    expect(await sendVisit(change, client)).toEqual({ revision: 7, noteMissing: false });
    expect(rpc).toHaveBeenCalledWith('save_visit', { visit: visitPayload(change) });
  });

  it('saves the visit without a voice note whose recording is gone from the phone', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 8, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
    const client = { rpc, from } as unknown as AppSupabaseClient;
    const change = {
      ...nextVisitChange(new QueryClient(), visit(), 7, LABEL),
      note: {
        noteId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
        fileId: '6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c',
        contentType: 'audio/webm' as const,
        durationMs: 40_000,
        language: 'hi' as const,
        recordedAt: '2026-10-21T05:00:00.000Z',
      },
    };
    const sent = await sendVisit(change, client, () => Promise.reject(new Error('Gone.')));
    expect(sent).toEqual({ revision: 8, noteMissing: true });
  });

  it('refuses for good a visit changed on another device, or one that is closed', async () => {
    const change = nextVisitChange(new QueryClient(), visit(), 6, LABEL);
    const stale = supabaseAnswering({
      data: null,
      error: { code: '40001', message: 'The visit was changed on another device.' },
    });
    await expect(sendVisit(change, stale.client)).rejects.toEqual(
      expect.objectContaining({ code: STALE_VISIT }),
    );
    await expect(sendVisit(change, stale.client)).rejects.toBeInstanceOf(ChangeRejectedError);
    const closed = supabaseAnswering({
      data: null,
      error: { code: '42501', message: 'This visit can no longer be changed.' },
    });
    await expect(sendVisit(change, closed.client)).rejects.toEqual(
      expect.objectContaining({ code: CLOSED_VISIT }),
    );
    // Other refusals keep their database code.
    const other = supabaseAnswering({ data: null, error: { code: '23514', message: 'No.' } });
    await expect(sendVisit(change, other.client)).rejects.toEqual(
      expect.objectContaining({ code: '23514' }),
    );
  });
});
