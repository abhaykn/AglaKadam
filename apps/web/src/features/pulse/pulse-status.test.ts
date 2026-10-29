import { describe, expect, it } from 'vitest';
import type {
  PulseCheckChange,
  PulseCheckSummary,
  PulseChild,
  PulseCycleView,
  RecordedCheckChange,
} from './pulse-change';
import { progressOf, statusOf, type WaitingAbsence, type WaitingCheck } from './pulse-status';

const TODAY = '2026-10-10';

function child(overrides: Partial<PulseChild> = {}): PulseChild {
  return {
    sampleId: 'sample-1',
    studentId: 'student-1',
    name: 'Asha',
    studentCode: '1000000008',
    adapted: false,
    week: 2,
    opensOn: '2026-10-08',
    dueOn: '2026-10-14',
    replacesSampleId: null,
    replacedAt: null,
    replacementReason: null,
    checks: [],
    absences: [],
    ...overrides,
  };
}

function waiting(change: PulseCheckChange, state: WaitingCheck['state'] = 'pending'): WaitingCheck {
  return {
    outboxId: `outbox-${change.checkId}`,
    state,
    error: state === 'failed' ? { code: '42501', message: 'refused' } : null,
    change,
  };
}

function waitingCheck(
  overrides: Partial<RecordedCheckChange> = {},
  state: WaitingCheck['state'] = 'pending',
): WaitingCheck {
  return waiting(
    {
      mode: 'recorded',
      checkId: 'check-1',
      sampleId: 'sample-1',
      classSectionId: 'class-1',
      studentId: 'student-1',
      attempt: 1,
      itemCode: 'hi-g2-p01',
      promptCode: 'en-g2-s01',
      item: {},
      fileId: 'file-1',
      contentType: 'audio/webm',
      durationMs: 58_000,
      noiseDbfs: -50,
      readingLevel: 'fluent',
      englishLevel: 'sentences',
      clarity: 'clear',
      classroom: 'normal',
      tags: [],
      recordedAt: '2026-10-10T09:00:00+05:30',
      childName: 'Asha',
      classLabel: { grade: 2, section: 'A' },
      ...overrides,
    },
    state,
  );
}

const waitingAdapted = (state: WaitingCheck['state'] = 'pending') =>
  waiting(
    {
      mode: 'adapted',
      checkId: 'check-a',
      sampleId: 'sample-1',
      classSectionId: 'class-1',
      studentId: 'student-1',
      readingLevel: 'hesitant',
      englishLevel: 'words',
      tags: [],
      recordedAt: '2026-10-10T09:00:00+05:30',
      childName: 'Asha',
      classLabel: { grade: 2, section: 'A' },
    },
    state,
  );

const serverCheck = (
  attempt: number,
  classroom: 'normal' | 'noisy' = 'normal',
): PulseCheckSummary => ({
  id: `check-${String(attempt)}`,
  attempt,
  mode: 'recorded',
  classroom,
  itemCode: `hi-g2-p0${String(attempt)}`,
  promptCode: `en-g2-s0${String(attempt)}`,
  recordedAt: '2026-10-09T09:00:00+05:30',
});

const serverAdapted: PulseCheckSummary = {
  id: 'check-a',
  attempt: 1,
  mode: 'adapted',
  classroom: null,
  itemCode: null,
  promptCode: null,
  recordedAt: '2026-10-09T09:00:00+05:30',
};

describe('where a drawn child stands', () => {
  it('is due until recorded, and late after the end of the week', () => {
    expect(statusOf(child(), TODAY, [], [])).toEqual({
      kind: 'due',
      late: false,
      absentToday: false,
    });
    expect(statusOf(child({ dueOn: '2026-10-07' }), TODAY, [], [])).toMatchObject({ late: true });
  });

  it('is absent today when marked on the server or waiting on the device', () => {
    expect(statusOf(child({ absences: [TODAY] }), TODAY, [], [])).toMatchObject({
      absentToday: true,
    });
    const waiting: WaitingAbsence = {
      state: 'pending',
      change: {
        sampleId: 'sample-1',
        classSectionId: 'class-1',
        date: TODAY,
        childName: 'Asha',
        classLabel: { grade: 2, section: 'A' },
      },
    };
    expect(statusOf(child(), TODAY, [], [waiting])).toMatchObject({ absentToday: true });
    expect(statusOf(child({ absences: ['2026-10-09'] }), TODAY, [], [])).toMatchObject({
      absentToday: false,
    });
    // An absence the server refused leaves the child to be marked or recorded again.
    expect(statusOf(child(), TODAY, [], [{ ...waiting, state: 'failed' }])).toMatchObject({
      absentToday: false,
    });
  });

  it('is recorded once the server has the check, or while it waits on the device', () => {
    expect(statusOf(child({ checks: [serverCheck(1)] }), TODAY, [], [])).toMatchObject({
      kind: 'recorded',
      first: {
        where: 'server',
        mode: 'recorded',
        itemCode: 'hi-g2-p01',
        promptCode: 'en-g2-s01',
      },
      canRetake: false,
    });
    expect(statusOf(child(), TODAY, [waitingCheck()], [])).toMatchObject({
      kind: 'recorded',
      first: { where: 'device' },
    });
    expect(statusOf(child(), TODAY, [waitingCheck({}, 'failed')], [])).toMatchObject({
      kind: 'recorded',
      first: { where: 'refused' },
      canRetake: false,
    });
  });

  it('allows one second recording only after a noisy classroom', () => {
    expect(statusOf(child({ checks: [serverCheck(1, 'noisy')] }), TODAY, [], [])).toMatchObject({
      canRetake: true,
      secondRecorded: false,
    });
    expect(
      statusOf(child({ checks: [serverCheck(1, 'noisy'), serverCheck(2)] }), TODAY, [], []),
    ).toMatchObject({ canRetake: false, secondRecorded: true });
    expect(
      statusOf(
        child(),
        TODAY,
        [
          waitingCheck({ classroom: 'noisy' }),
          waitingCheck({
            checkId: 'check-2',
            attempt: 2,
            itemCode: 'hi-g2-p02',
            promptCode: 'en-g2-s02',
          }),
        ],
        [],
      ),
    ).toMatchObject({ canRetake: false, secondRecorded: true });
  });

  it('offers a second recording only once the server has the noisy first one', () => {
    expect(statusOf(child(), TODAY, [waitingCheck({ classroom: 'noisy' })], [])).toMatchObject({
      kind: 'recorded',
      first: { where: 'device', classroom: 'noisy' },
      canRetake: false,
    });
  });

  it('shows a refused second recording as refused, and offers another once it is removed', () => {
    const refusedSecond = waitingCheck(
      { checkId: 'check-2', attempt: 2, itemCode: 'hi-g2-p02', promptCode: 'en-g2-s02' },
      'failed',
    );
    expect(
      statusOf(child({ checks: [serverCheck(1, 'noisy')] }), TODAY, [refusedSecond], []),
    ).toMatchObject({ secondRecorded: false, secondWaiting: refusedSecond, canRetake: false });
  });

  it('never offers a second attempt after a noisy room the server refused', () => {
    expect(
      statusOf(child(), TODAY, [waitingCheck({ classroom: 'noisy' }, 'failed')], []),
    ).toMatchObject({ canRetake: false, first: { where: 'refused' } });
  });

  it('records an adapted check once, with nothing to retake', () => {
    const adaptedChild = child({ adapted: true });
    expect(statusOf({ ...adaptedChild, checks: [serverAdapted] }, TODAY, [], [])).toEqual({
      kind: 'recorded',
      first: {
        mode: 'adapted',
        itemCode: null,
        promptCode: null,
        classroom: null,
        where: 'server',
        waiting: null,
      },
      secondRecorded: false,
      secondWaiting: null,
      canRetake: false,
    });
    const onDevice = waitingAdapted();
    expect(statusOf(adaptedChild, TODAY, [onDevice], [])).toMatchObject({
      kind: 'recorded',
      first: { mode: 'adapted', where: 'device', waiting: onDevice },
      canRetake: false,
    });
    expect(statusOf(adaptedChild, TODAY, [waitingAdapted('failed')], [])).toMatchObject({
      first: { where: 'refused' },
    });
  });

  it('is replaced when the database replaced the child and nothing was recorded', () => {
    const replaced = child({ replacedAt: '2026-10-08T00:05:00Z', replacementReason: 'left' });
    expect(statusOf(replaced, TODAY, [], [])).toEqual({ kind: 'replaced', reason: 'left' });
    // A check recorded before the replacement still counts.
    expect(statusOf({ ...replaced, checks: [serverCheck(1)] }, TODAY, [], [])).toMatchObject({
      kind: 'recorded',
    });
  });

  it('ignores waiting checks of other children', () => {
    expect(statusOf(child(), TODAY, [waitingCheck({ sampleId: 'sample-2' })], [])).toMatchObject({
      kind: 'due',
    });
  });
});

describe('progress of the month', () => {
  const view = (children: PulseChild[], sampleSize = 20): PulseCycleView => ({
    cycle: {
      id: 'cycle-1',
      month: '2026-10-01',
      grade: 2,
      language: 'hi',
      firstWeek: 1,
      sampleSize,
      eligibleCount: 32,
    },
    children,
    seenItems: {},
    weeks: [],
  });

  it('counts recorded children against the draw and the children still hidden', () => {
    const children = [
      child({ sampleId: 'a', name: 'Bina', dueOn: '2026-10-14' }),
      child({ sampleId: 'b', name: 'Arun', dueOn: '2026-10-07' }),
      child({ sampleId: 'c', checks: [serverCheck(1)] }),
      child({ sampleId: 'd', replacedAt: '2026-10-08T00:05:00Z', replacementReason: 'absent' }),
      child({ sampleId: 'e', replacesSampleId: 'd' }),
    ];
    const progress = progressOf(view(children), TODAY, [], []);
    expect(progress.recorded).toBe(1);
    // A check the server refused is listed with its reason but does not count.
    const refused = waitingCheck({ sampleId: 'a' }, 'failed');
    expect(progressOf(view(children), TODAY, [refused], []).recorded).toBe(1);
    expect(progressOf(view(children), TODAY, [waitingCheck({ sampleId: 'a' })], []).recorded).toBe(
      2,
    );
    expect(progress.target).toBe(20);
    // Four drawn children are visible; the replacement does not reduce the hidden count.
    expect(progress.hidden).toBe(16);
    // Late children first, then by the day they are due and by name.
    expect(progress.due.map((entry) => entry.sampleId)).toEqual(['b', 'e', 'a']);
    expect(progress.replaced.map((entry) => entry.sampleId)).toEqual(['d']);
  });
});
