import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import type { AppSupabaseClient } from '@/lib/supabase';
import {
  examPayload,
  forgetFinishedSaves,
  marksPayload,
  marksSaved,
  marksSavesKey,
  nextMarksChange,
  reconcileMarksSaves,
  sendMarks,
  STALE_MARKS,
} from './exam-change';
import { buildExam, type ScheduleInput } from './schedule';

const YEAR = {
  id: '0a1b2c3d-4e5f-4061-8273-a4b5c6d7e8f9',
  startsOn: '2026-04-01',
  endsOn: '2027-03-31',
};
const CLASS_1 = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CLASS_2 = '7a2d3b4c-5e6f-4071-8b8c-0d1e2f3a4b5c';
const CLASS_3 = '8b3e4c5d-6f70-4182-9c9d-1e2f3a4b5c6d';
let counter = 0;

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    examId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    academicYear: YEAR,
    kind: 'half_yearly',
    title: '  Half-yearly 2026  ',
    clusterId: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
    schoolId: null,
    classes: [
      { id: CLASS_1, grade: 1 },
      { id: CLASS_2, grade: 2 },
      { id: CLASS_3, grade: 5 },
    ],
    grades: [1, 2],
    subjects: [
      { subject: 'hindi', subjectName: '', heldOn: '2026-10-26' },
      { subject: 'other', subjectName: ' Art ', heldOn: '2026-10-28' },
    ],
    scale: 'marks',
    maxMarks: '50',
    today: '2026-10-21',
    newId: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
    ...overrides,
  };
}

describe('scheduling an exam', () => {
  it('makes a paper for each subject in each class of the grades chosen', () => {
    const built = buildExam(input());
    if (!('exam' in built)) {
      throw new Error(`Refused: ${built.problem}`);
    }
    const { exam } = built;
    expect(exam).toMatchObject({
      title: 'Half-yearly 2026',
      startsOn: '2026-10-26',
      endsOn: '2026-10-28',
    });
    expect(exam.papers.map((paper) => [paper.classSectionId, paper.subject, paper.heldOn])).toEqual(
      [
        [CLASS_1, 'hindi', '2026-10-26'],
        [CLASS_1, 'other', '2026-10-28'],
        [CLASS_2, 'hindi', '2026-10-26'],
        [CLASS_2, 'other', '2026-10-28'],
      ],
    );
    expect(exam.papers[1]).toMatchObject({ subjectName: 'Art', maxMarks: 50 });
    const payload = examPayload(exam) as { papers: { subject_name: string | null }[] };
    expect(payload.papers.map((paper) => paper.subject_name)).toEqual([null, 'Art', null, 'Art']);
  });

  it('shows a slip before anything is saved', () => {
    const problem = (overrides: Partial<ScheduleInput>) => {
      const built = buildExam(input(overrides));
      return 'problem' in built ? built.problem : null;
    };
    expect(problem({ academicYear: null })).toBe('noYear');
    expect(problem({ subjects: [] })).toBe('needSubject');
    expect(
      problem({ subjects: [{ subject: 'other', subjectName: ' ', heldOn: '2026-10-26' }] }),
    ).toBe('needOtherName');
    expect(problem({ grades: [3] })).toBe('needGrade');
    expect(problem({ maxMarks: '0' })).toBe('maxInvalid');
    expect(problem({ maxMarks: '501' })).toBe('maxInvalid');
    expect(problem({ maxMarks: '12.5' })).toBe('maxInvalid');
    // Grades need no maximum.
    expect(problem({ scale: 'grades', maxMarks: '' })).toBeNull();
    // Papers more than 45 days apart, outside the session, or begun too long ago.
    expect(
      problem({
        subjects: [
          { subject: 'hindi', subjectName: '', heldOn: '2026-10-26' },
          { subject: 'maths', subjectName: '', heldOn: '2026-12-26' },
        ],
      }),
    ).toBe('datesInvalid');
    expect(
      problem({ subjects: [{ subject: 'hindi', subjectName: '', heldOn: '2027-04-02' }] }),
    ).toBe('datesInvalid');
    expect(
      problem({ subjects: [{ subject: 'hindi', subjectName: '', heldOn: '2026-08-01' }] }),
    ).toBe('datesInvalid');
  });
});

describe('saving marks from the phone', () => {
  const paper = {
    id: '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b',
    classSectionId: CLASS_1,
    revision: 4,
    subject: 'hindi' as const,
    subjectName: null,
  };
  const marks = [{ studentId: CLASS_2, marks: 12.5, grade: null, absent: false }];

  it('builds every save on the revision it read and its own earlier saves', () => {
    const queryClient = new QueryClient();
    const first = nextMarksChange(queryClient, paper, marks, null);
    expect(first).toMatchObject({ baseRevision: 4, supersedes: [] });
    const second = nextMarksChange(queryClient, paper, marks, null);
    expect(second).toMatchObject({ baseRevision: 4, supersedes: [first.changeId] });

    // The first is written; the second still waits and builds on its revision.
    marksSaved(queryClient, first, 5);
    expect(queryClient.getQueryData(marksSavesKey(paper.id))).toEqual({
      baseRevision: 5,
      pending: [second.changeId],
    });
    const third = nextMarksChange(queryClient, paper, marks, null);
    expect(third).toMatchObject({ baseRevision: 5, supersedes: [second.changeId] });

    // The server then holds the third (sent while no page was open): nothing is left to wait for.
    reconcileMarksSaves(queryClient, { id: paper.id, revision: 7, clientChangeId: third.changeId });
    expect(queryClient.getQueryData(marksSavesKey(paper.id))).toBeNull();
  });

  it('forgets saves that no longer wait on the phone, but not a revision just written', () => {
    const queryClient = new QueryClient();
    nextMarksChange(queryClient, paper, marks, null);
    // The waiting save was sent while no page was open, or discarded: the server's marks rule.
    forgetFinishedSaves(queryClient, paper.id);
    expect(queryClient.getQueryData(marksSavesKey(paper.id))).toBeNull();

    const change = nextMarksChange(queryClient, paper, marks, null);
    marksSaved(queryClient, change, 5);
    forgetFinishedSaves(queryClient, paper.id);
    expect(queryClient.getQueryData(marksSavesKey(paper.id))).toEqual({
      baseRevision: 5,
      pending: [],
    });
  });

  it('keeps the revision written until the list of papers catches up', () => {
    const queryClient = new QueryClient();
    const change = nextMarksChange(queryClient, paper, marks, null);
    marksSaved(queryClient, change, 5);
    // The list read before the save still says 4: the next save must build on 5.
    reconcileMarksSaves(queryClient, { id: paper.id, revision: 4, clientChangeId: null });
    expect(nextMarksChange(queryClient, paper, marks, null).baseRevision).toBe(5);
  });

  it('sends absent children without marks, and refuses for good marks changed elsewhere', async () => {
    const change = nextMarksChange(
      new QueryClient(),
      paper,
      [...marks, { studentId: CLASS_3, marks: null, grade: null, absent: true }],
      null,
    );
    expect(marksPayload(change)).toMatchObject({
      paper_id: paper.id,
      base_revision: 4,
      entries: [
        { student_id: CLASS_2, marks: 12.5, grade: null, absent: false },
        { student_id: CLASS_3, absent: true },
      ],
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'The marks were changed on another device.' },
    });
    const client = { rpc } as unknown as AppSupabaseClient;
    await expect(sendMarks(change, client)).rejects.toBeInstanceOf(ChangeRejectedError);
    await expect(sendMarks(change, client)).rejects.toMatchObject({ code: STALE_MARKS });
    // A paper not on the server yet is sent again later.
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'The paper is not on the server yet.' },
    });
    await expect(sendMarks(change, client)).rejects.toMatchObject({ code: '55000' });
  });
});
