import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { z } from 'zod';
import { registerChange } from '@/features/offline/change-registry';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import { classLabel } from '@/features/workspaces/grade-label';
import type { Json } from '@/lib/database.types';
import type { AppSupabaseClient } from '@/lib/supabase';
import { GRADES } from './marks';

/**
 * Exams, the dates of their papers and the marks of each paper, as changes kept on the device and
 * sent when a network is available. Like attendance and visits, they depend on nothing that exists
 * only in a page, so the service worker can send them after the application has been closed.
 */

export const EXAM_KINDS = ['class_test', 'unit_test', 'half_yearly', 'annual'] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

export const SUBJECTS = ['hindi', 'english', 'maths', 'evs', 'urdu', 'sanskrit', 'other'] as const;
export type Subject = (typeof SUBJECTS)[number];

/** Marks are entered from the day of a paper until this many days after it. */
export const MARKS_WINDOW_DAYS = 60;
/** The highest maximum a paper may have. */
export const MAX_MARKS_LIMIT = 500;
/** An exam's papers fall within this many days of its first. */
export const EXAM_SPAN_DAYS = 45;

/** Whether marks of a paper can be entered on a day: from the paper's day until 60 days after. */
export function marksOpen(heldOn: string, today: string): boolean {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${heldOn}T00:00:00Z`)) / 86_400_000,
  );
  return days >= 0 && days <= MARKS_WINDOW_DAYS;
}

/** Error code of marks refused because another device saved the paper's marks meanwhile. */
export const STALE_MARKS = 'stale_marks';
/** Error code of marks whose paper has not reached the server for a week: it was removed. */
export const PAPER_MISSING = 'paper_missing';
/** How long marks wait for their paper to reach the server before they count as refused. */
const PAPER_WAIT_MS = 7 * 86_400_000;

/** The papers of a class, with their exams and how many children have a result. */
export function classExamsKey(classSectionId: string) {
  return ['class-exams', classSectionId] as const;
}

/** The exams the CRP sees: those of their cluster and of its schools. */
export function clusterExamsKey() {
  return ['cluster-exams'] as const;
}

export function paperMarksKey(paperId: string) {
  return ['paper-marks', paperId] as const;
}

export function markChangesKey(paperId: string) {
  return ['mark-changes', paperId] as const;
}

/** The phone's own saves of a paper's marks still to be confirmed, and the revision they build on. */
export function marksSavesKey(paperId: string) {
  return ['marks-saves', paperId] as const;
}

/** Marks typed on the phone and not yet saved, kept so that a closed page loses nothing. */
export function marksDraftKey(paperId: string) {
  return ['marks-draft', paperId] as const;
}

export function marksChecksKey() {
  return ['marks-checks'] as const;
}

/** The result sheets of every exam, which change with any exam or marks. */
export function examResultsKey() {
  return ['exam-result'] as const;
}

export function examResultKey(examId: string, classSectionId: string) {
  return ['exam-result', examId, classSectionId] as const;
}

const isoDate = z.iso.date();
const classLabelSchema = z.object({ grade: z.number().int(), section: z.string() });

export const paperSchema = z.object({
  id: z.guid(),
  classSectionId: z.guid(),
  subject: z.enum(SUBJECTS),
  subjectName: z.string().trim().min(1).max(40).nullable(),
  heldOn: isoDate,
  scale: z.enum(['marks', 'grades']),
  maxMarks: z.number().int().min(1).max(MAX_MARKS_LIMIT).nullable(),
});

export type ExamPaper = z.infer<typeof paperSchema>;

export const examSchema = z.object({
  id: z.guid(),
  academicYearId: z.guid(),
  kind: z.enum(EXAM_KINDS),
  title: z.string().max(80),
  clusterId: z.guid().nullable(),
  schoolId: z.guid().nullable(),
  startsOn: isoDate,
  endsOn: isoDate,
  papers: z.array(paperSchema).min(1).max(600),
});

export type Exam = z.infer<typeof examSchema>;

/** The name of an exam: its own title, or its kind. */
export function examName(exam: Pick<Exam, 'kind' | 'title'>, t: TFunction): string {
  return exam.title.trim() || t(`exams.kind.${exam.kind}`);
}

/** The name of a paper's subject. */
export function subjectName(
  paper: Pick<ExamPaper, 'subject' | 'subjectName'>,
  t: TFunction,
): string {
  return paper.subject === 'other' && paper.subjectName
    ? paper.subjectName
    : t(`exams.subject.${paper.subject}`);
}

/** The exam as `save_exam` takes it. */
export function examPayload(exam: Exam): Json {
  return {
    id: exam.id,
    academic_year_id: exam.academicYearId,
    kind: exam.kind,
    title: exam.title.trim() || null,
    cluster_id: exam.clusterId,
    school_id: exam.schoolId,
    starts_on: exam.startsOn,
    ends_on: exam.endsOn,
    papers: exam.papers.map((paper) => ({
      id: paper.id,
      class_section_id: paper.classSectionId,
      subject: paper.subject,
      subject_name: paper.subject === 'other' ? paper.subjectName : null,
      held_on: paper.heldOn,
      scale: paper.scale,
      max_marks: paper.scale === 'marks' ? paper.maxMarks : null,
    })),
  };
}

export function examDedupeKey(examId: string): string {
  return `exam:${examId}`;
}

export function paperDedupeKey(paperId: string): string {
  return `exam-paper:${paperId}`;
}

export function marksDedupeKey(paperId: string): string {
  return `exam-marks:${paperId}`;
}

function formatDate(date: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Schedules an exam, or changes one the person scheduled. */
export const examSaveChange = registerChange<Exam>({
  kind: 'exam.save',
  schema: examSchema,
  send: async (exam, context) => {
    const { error } = await context.supabase.rpc('save_exam', { exam: examPayload(exam) });
    if (error) {
      throw error;
    }
    return null;
  },
  invalidates: (exam) => [
    clusterExamsKey(),
    examResultsKey(),
    ...[...new Set(exam.papers.map((paper) => paper.classSectionId))].map((id) =>
      classExamsKey(id),
    ),
  ],
  describe: (exam, t, language) =>
    t('exams.change.save', { exam: examName(exam, t), date: formatDate(exam.startsOn, language) }),
});

const examRemoveSchema = z.object({
  examId: z.guid(),
  kind: z.enum(EXAM_KINDS),
  title: z.string().max(80),
  classSectionIds: z.array(z.guid()).max(600),
});

export type ExamRemoveChange = z.infer<typeof examRemoveSchema>;

/** Removes an exam that has no marks yet. */
export const examRemoveChange = registerChange<ExamRemoveChange>({
  kind: 'exam.remove',
  schema: examRemoveSchema,
  send: async (change, context) => {
    const { error } = await context.supabase.rpc('remove_exam', { target_exam_id: change.examId });
    if (error) {
      throw error;
    }
    return null;
  },
  invalidates: (change) => [
    clusterExamsKey(),
    examResultsKey(),
    ...change.classSectionIds.map((id) => classExamsKey(id)),
  ],
  describe: (change, t) => t('exams.change.remove', { exam: examName(change, t) }),
});

const paperMoveSchema = z.object({
  paperId: z.guid(),
  classSectionId: z.guid(),
  heldOn: isoDate,
  maxMarks: z.number().int().min(1).max(MAX_MARKS_LIMIT).nullable(),
  subject: z.enum(SUBJECTS),
  subjectName: z.string().max(40).nullable(),
});

export type PaperMoveChange = z.infer<typeof paperMoveSchema>;

/** Moves a paper to another day of its exam, or changes its maximum. */
export const paperMoveChange = registerChange<PaperMoveChange>({
  kind: 'exam.paper',
  schema: paperMoveSchema,
  send: async (change, context) => {
    const { error } = await context.supabase.rpc('move_exam_paper', {
      target_paper_id: change.paperId,
      new_held_on: change.heldOn,
      ...(change.maxMarks === null ? {} : { new_max_marks: change.maxMarks }),
    });
    if (error) {
      throw error;
    }
    return null;
  },
  invalidates: (change) => [
    clusterExamsKey(),
    examResultsKey(),
    classExamsKey(change.classSectionId),
    paperMarksKey(change.paperId),
  ],
  describe: (change, t, language) =>
    t('exams.change.move', {
      subject: subjectName(change, t),
      date: formatDate(change.heldOn, language),
    }),
});

const entrySchema = z.object({
  studentId: z.guid(),
  marks: z.number().min(0).max(MAX_MARKS_LIMIT).nullable(),
  grade: z.enum(GRADES).nullable(),
  absent: z.boolean(),
});

const marksChangeSchema = z.object({
  paperId: z.guid(),
  classSectionId: z.guid(),
  /** The server's revision the phone started from. */
  baseRevision: z.number().int().min(0).nullable(),
  changeId: z.guid(),
  /** This phone's earlier saves of the paper that this one replaces. */
  supersedes: z.array(z.guid()).max(50),
  entries: z.array(entrySchema).max(200),
  subject: z.enum(SUBJECTS),
  subjectName: z.string().max(40).nullable(),
  classLabel: classLabelSchema.nullable(),
  /** When the teacher saved; marks whose paper never reaches the server are given up on. */
  savedAt: z.iso.datetime({ offset: true }).optional(),
});

export type MarksChange = z.infer<typeof marksChangeSchema>;

/** The phone's own saves of a paper's marks that the server has not confirmed yet. */
export interface MarksSaves {
  baseRevision: number | null;
  pending: string[];
}

const PENDING_LIMIT = 50;

/** Keeps the phone's saves and typed marks on the device for as long as they matter. */
export function rememberExamQueries(queryClient: QueryClient): void {
  for (const key of [['marks-saves'], ['marks-draft']]) {
    queryClient.setQueryDefaults(key, {
      meta: { persist: true },
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    });
  }
}

/**
 * The change that saves a paper's marks. The first save of the phone starts from the revision it
 * last read; later ones start from the same revision and name the saves before them, so that the
 * server can tell the phone's own saves from another device's.
 */
export function nextMarksChange(
  queryClient: QueryClient,
  paper: {
    id: string;
    classSectionId: string;
    revision: number;
    subject: ExamPaper['subject'];
    subjectName: string | null;
  },
  entries: MarksChange['entries'],
  label: MarksChange['classLabel'],
): MarksChange {
  rememberExamQueries(queryClient);
  const saves = queryClient.getQueryData<MarksSaves | null>(marksSavesKey(paper.id)) ?? null;
  const baseRevision = saves ? saves.baseRevision : paper.revision;
  const pending = saves?.pending ?? [];
  const changeId = crypto.randomUUID();
  queryClient.setQueryData<MarksSaves>(marksSavesKey(paper.id), {
    baseRevision,
    pending: [...pending, changeId].slice(-PENDING_LIMIT),
  });
  return {
    paperId: paper.id,
    classSectionId: paper.classSectionId,
    baseRevision,
    changeId,
    supersedes: pending.slice(-PENDING_LIMIT),
    entries,
    subject: paper.subject,
    subjectName: paper.subjectName,
    classLabel: label,
    savedAt: new Date().toISOString(),
  };
}

/**
 * After the server wrote a save: later saves build on its revision, also before the list of
 * papers has been read again.
 */
export function marksSaved(queryClient: QueryClient, change: MarksChange, revision: number): void {
  queryClient.setQueryData<MarksSaves | null>(marksSavesKey(change.paperId), (saves) => {
    const pending = saves?.pending ?? [];
    const index = pending.indexOf(change.changeId);
    return {
      baseRevision: revision,
      pending: index === -1 ? pending : pending.slice(index + 1),
    };
  });
}

/**
 * Brings the phone's saves in line with the paper as the server holds it, also when a save was
 * sent while no page was open: the server's last save is recognised by its identifier.
 */
export function reconcileMarksSaves(
  queryClient: QueryClient,
  paper: { id: string; revision: number; clientChangeId: string | null },
): void {
  const saves = queryClient.getQueryData<MarksSaves | null>(marksSavesKey(paper.id));
  if (!saves) {
    return;
  }
  const index = paper.clientChangeId === null ? -1 : saves.pending.indexOf(paper.clientChangeId);
  const pending = index === -1 ? saves.pending : saves.pending.slice(index + 1);
  const baseRevision = index === -1 ? saves.baseRevision : paper.revision;
  // Nothing left to send, and the list read from the server is as new: it is the base from now on.
  if (pending.length === 0 && paper.revision >= (baseRevision ?? 0)) {
    queryClient.setQueryData(marksSavesKey(paper.id), null);
    return;
  }
  if (index !== -1) {
    queryClient.setQueryData<MarksSaves>(marksSavesKey(paper.id), { baseRevision, pending });
  }
}

/**
 * Once no save of the paper waits on the phone, the saves it still lists were sent (possibly by the
 * service worker) or discarded: the server's revision is the base from now on. A record with
 * nothing listed is kept, since it holds the revision of a save just written.
 */
export function forgetFinishedSaves(queryClient: QueryClient, paperId: string): void {
  const saves = queryClient.getQueryData<MarksSaves | null>(marksSavesKey(paperId));
  if (saves && saves.pending.length > 0) {
    queryClient.setQueryData(marksSavesKey(paperId), null);
  }
}

/** Forgets the phone's saves of a paper, for example to take the server's marks instead. */
export function forgetMarksSaves(queryClient: QueryClient, paperId: string): void {
  queryClient.setQueryData(marksSavesKey(paperId), null);
}

/** The marks as `save_exam_marks` takes them. */
export function marksPayload(change: MarksChange): Json {
  return {
    paper_id: change.paperId,
    change_id: change.changeId,
    base_revision: change.baseRevision,
    supersedes: change.supersedes,
    entries: change.entries.map((entry) =>
      entry.absent
        ? { student_id: entry.studentId, absent: true }
        : {
            student_id: entry.studentId,
            marks: entry.marks,
            grade: entry.grade,
            absent: false,
          },
    ),
  };
}

/** Sends a paper's marks; returns the paper's new revision. */
export async function sendMarks(change: MarksChange, supabase: AppSupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('save_exam_marks', {
    paper_marks: marksPayload(change),
  });
  if (error) {
    if (error.code === '40001') {
      // Not a passing conflict: sending the same save again would be refused the same way.
      throw new ChangeRejectedError(STALE_MARKS, error.message);
    }
    // The paper's exam may still be on its way from this phone; after a week it was removed.
    if (
      error.code === '55000' &&
      change.savedAt !== undefined &&
      Date.now() - Date.parse(change.savedAt) > PAPER_WAIT_MS
    ) {
      throw new ChangeRejectedError(PAPER_MISSING, error.message);
    }
    throw error;
  }
  return data;
}

export const marksChange = registerChange<MarksChange>({
  kind: 'exam.marks',
  schema: marksChangeSchema,
  send: (change, context) => sendMarks(change, context.supabase),
  onSent: (change, result, queryClient) => {
    marksSaved(queryClient, change, Number(result));
  },
  invalidates: (change) => [
    paperMarksKey(change.paperId),
    markChangesKey(change.paperId),
    classExamsKey(change.classSectionId),
    clusterExamsKey(),
    marksChecksKey(),
    examResultsKey(),
  ],
  describe: (change, t) =>
    t('exams.change.marks', {
      subject: subjectName(change, t),
      class: change.classLabel
        ? classLabel(t, change.classLabel.grade, change.classLabel.section)
        : t('exams.classFallback'),
    }),
});
