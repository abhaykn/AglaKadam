import { queryOptions, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import type { RosterEntry } from '@/features/attendance/attendance-api';
import { keepOrSend } from '@/features/offline/keep-or-send';
import { getSupabase } from '@/lib/supabase';
import {
  classExamsKey,
  clusterExamsKey,
  EXAM_KINDS,
  examDedupeKey,
  examRemoveChange,
  examResultKey,
  examSaveChange,
  markChangesKey,
  marksChange,
  marksChecksKey,
  marksDedupeKey,
  marksOpen,
  nextMarksChange,
  paperDedupeKey,
  paperMarksKey,
  paperMoveChange,
  sendMarks,
  SUBJECTS,
  type Exam,
  type ExamKind,
  type ExamRemoveChange,
  type MarksChange,
  type PaperMoveChange,
  type Subject,
} from './exam-change';
import { GRADES, type Grade, type MarkEntry } from './marks';

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return values.find((entry) => entry === value) ?? fallback;
}

function gradeOf(value: string | null): Grade | null {
  return GRADES.find((grade) => grade === value) ?? null;
}

/** An exam as the server holds it, without its papers. */
export interface ExamSummary {
  id: string;
  academicYearId: string;
  kind: ExamKind;
  title: string;
  clusterId: string | null;
  schoolId: string | null;
  startsOn: string;
  endsOn: string;
  createdBy: string | null;
}

/** A paper as the server holds it, with how many children have a result. */
export interface StoredPaper {
  id: string;
  examId: string;
  classSectionId: string;
  schoolId: string;
  subject: Subject;
  subjectName: string | null;
  heldOn: string;
  scale: 'marks' | 'grades';
  maxMarks: number | null;
  revision: number;
  clientChangeId: string | null;
  results: number;
}

export interface ClassPaper extends StoredPaper {
  exam: ExamSummary;
}

interface ExamRow {
  id: string;
  academic_year_id: string;
  kind: string;
  title: string | null;
  cluster_id: string | null;
  school_id: string | null;
  starts_on: string;
  ends_on: string;
  created_by: string | null;
}

interface PaperRow {
  id: string;
  exam_id: string;
  class_section_id: string;
  school_id: string;
  subject: string;
  subject_name: string | null;
  held_on: string;
  scale: string;
  max_marks: number | null;
  revision: number;
  client_change_id: string | null;
  exam_marks: { count: number }[];
}

function toExam(row: ExamRow): ExamSummary {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    kind: oneOf(EXAM_KINDS, row.kind, 'class_test'),
    title: row.title ?? '',
    clusterId: row.cluster_id,
    schoolId: row.school_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdBy: row.created_by,
  };
}

function toPaper(row: PaperRow): StoredPaper {
  return {
    id: row.id,
    examId: row.exam_id,
    classSectionId: row.class_section_id,
    schoolId: row.school_id,
    subject: oneOf(SUBJECTS, row.subject, 'other'),
    subjectName: row.subject_name,
    heldOn: row.held_on,
    scale: row.scale === 'grades' ? 'grades' : 'marks',
    maxMarks: row.max_marks,
    revision: row.revision,
    clientChangeId: row.client_change_id,
    results: row.exam_marks[0]?.count ?? 0,
  };
}

const EXAM_COLUMNS =
  'id, academic_year_id, kind, title, cluster_id, school_id, starts_on, ends_on, created_by';
const PAPER_COLUMNS =
  'id, exam_id, class_section_id, school_id, subject, subject_name, held_on, scale, max_marks, revision, client_change_id, exam_marks(count)';

/** The papers of a class in the current session, newest first, each with its exam. */
export function classExamsQuery(classSectionId: string) {
  return queryOptions({
    queryKey: classExamsKey(classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<ClassPaper[]> => {
      const { data, error } = await getSupabase()
        .from('exam_papers')
        .select(`${PAPER_COLUMNS}, exams!inner(${EXAM_COLUMNS})`)
        .eq('class_section_id', classSectionId)
        .order('held_on', { ascending: false });
      if (error) {
        throw error;
      }
      return (data as unknown as (PaperRow & { exams: ExamRow })[]).map((row) => ({
        ...toPaper(row),
        exam: toExam(row.exams),
      }));
    },
  });
}

export interface ClusterExam extends ExamSummary {
  papers: StoredPaper[];
}

/** The exams the CRP sees, newest first: those of their cluster and of its schools. */
export function clusterExamsQuery() {
  return queryOptions({
    queryKey: clusterExamsKey(),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<ClusterExam[]> => {
      const since = new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) - 365 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await getSupabase()
        .from('exams')
        .select(`${EXAM_COLUMNS}, exam_papers(${PAPER_COLUMNS})`)
        .gte('ends_on', since)
        .order('starts_on', { ascending: false })
        .limit(500);
      if (error) {
        throw error;
      }
      return (data as unknown as (ExamRow & { exam_papers: PaperRow[] })[]).map((row) => ({
        ...toExam(row),
        papers: row.exam_papers.map(toPaper),
      }));
    },
  });
}

export interface StoredMark extends MarkEntry {
  updatedAt: string;
}

/**
 * A paper's marks with the revision they belong to, read together so that a save always builds on
 * the marks shown.
 */
export interface PaperMarks {
  revision: number;
  clientChangeId: string | null;
  marks: StoredMark[];
}

/** The marks of a paper as the server holds them; null when the paper is not there. */
export function paperMarksQuery(paperId: string) {
  return queryOptions({
    queryKey: paperMarksKey(paperId),
    meta: { persist: true },
    staleTime: 30_000,
    queryFn: async (): Promise<PaperMarks | null> => {
      const { data, error } = await getSupabase()
        .from('exam_papers')
        .select(
          'revision, client_change_id, exam_marks(student_id, marks, grade, absent, updated_at)',
        )
        .eq('id', paperId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data
        ? {
            revision: data.revision,
            clientChangeId: data.client_change_id,
            marks: data.exam_marks.map((row) => ({
              studentId: row.student_id,
              marks: row.marks,
              grade: gradeOf(row.grade),
              absent: row.absent,
              updatedAt: row.updated_at,
            })),
          }
        : null;
    },
  });
}

/**
 * The children on a class's roll on any day from `from` to `to`, with their enrolment dates: the
 * roll of a paper's day (or an exam's days), also for children who have left since.
 */
export function examRollQuery(classSectionId: string, from: string, to: string) {
  return queryOptions({
    queryKey: ['exam-roll', classSectionId, from, to],
    meta: { persist: true },
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<RosterEntry[]> => {
      const { data, error } = await getSupabase()
        .from('enrolments')
        .select('enrolled_on, ended_on, students!inner(id, full_name, student_code)')
        .eq('class_section_id', classSectionId)
        .lte('enrolled_on', to)
        .or(`ended_on.is.null,ended_on.gte.${from}`);
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        studentId: row.students.id,
        fullName: row.students.full_name,
        studentCode: row.students.student_code,
        enrolledOn: row.enrolled_on,
        endedOn: row.ended_on,
      }));
    },
  });
}

/**
 * Keeps on the phone what entering marks needs for every paper open for marks: its marks and the
 * roll of its day, so that they can be entered without a network.
 */
export function prepareOpenPapers(
  queryClient: QueryClient,
  papers: readonly StoredPaper[],
  today: string,
): void {
  for (const paper of papers) {
    if (marksOpen(paper.heldOn, today)) {
      queryClient.query(paperMarksQuery(paper.id)).catch(() => undefined);
      queryClient
        .query(examRollQuery(paper.classSectionId, paper.heldOn, paper.heldOn))
        .catch(() => undefined);
    }
  }
}

export interface MarkChange {
  id: number;
  studentId: string;
  before: MarkEntry;
  after: MarkEntry | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

/** Marks of a paper corrected later or by someone else, newest first. */
export function markChangesQuery(paperId: string) {
  return queryOptions({
    queryKey: markChangesKey(paperId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<MarkChange[]> => {
      const { data, error } = await getSupabase()
        .from('exam_mark_changes')
        .select(
          'id, student_id, old_marks, old_grade, old_absent, new_marks, new_grade, new_absent, removed, changed_by, changed_at, profiles(full_name)',
        )
        .eq('paper_id', paperId)
        .order('changed_at', { ascending: false })
        .limit(100);
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        studentId: row.student_id,
        before: {
          studentId: row.student_id,
          marks: row.old_marks,
          grade: gradeOf(row.old_grade),
          absent: row.old_absent,
        },
        after: row.removed
          ? null
          : {
              studentId: row.student_id,
              marks: row.new_marks,
              grade: gradeOf(row.new_grade),
              absent: row.new_absent ?? false,
            },
        changedBy: row.changed_by,
        changedByName: row.profiles?.full_name ?? null,
        changedAt: row.changed_at,
      }));
    },
  });
}

export interface ExamResultPaper extends StoredPaper {
  marks: MarkEntry[];
}

/** The papers of one exam in one class with every child's result, for the result sheet. */
export function examResultQuery(examId: string, classSectionId: string) {
  return queryOptions({
    queryKey: examResultKey(examId, classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<{ exam: ExamSummary; papers: ExamResultPaper[] } | null> => {
      const { data, error } = await getSupabase()
        .from('exams')
        .select(
          `${EXAM_COLUMNS}, exam_papers(${PAPER_COLUMNS}, results:exam_marks(student_id, marks, grade, absent))`,
        )
        .eq('id', examId)
        .eq('exam_papers.class_section_id', classSectionId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }
      const row = data as unknown as ExamRow & {
        exam_papers: (PaperRow & {
          results: {
            student_id: string;
            marks: number | null;
            grade: string | null;
            absent: boolean;
          }[];
        })[];
      };
      return {
        exam: toExam(row),
        papers: row.exam_papers
          .map((paper) => ({
            ...toPaper(paper),
            marks: paper.results.map((mark) => ({
              studentId: mark.student_id,
              marks: mark.marks,
              grade: gradeOf(mark.grade),
              absent: mark.absent,
            })),
          }))
          .sort((a, b) => a.heldOn.localeCompare(b.heldOn) || a.subject.localeCompare(b.subject)),
      };
    },
  });
}

/** The current academic session, which exams are scheduled in. */
export function currentAcademicYearQuery() {
  return queryOptions({
    queryKey: ['current-academic-year'],
    meta: { persist: true },
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const today = todayInIndia();
      const { data, error } = await getSupabase()
        .from('academic_years')
        .select('id, label, starts_on, ends_on')
        .lte('starts_on', today)
        .gte('ends_on', today)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data
        ? { id: data.id, label: data.label, startsOn: data.starts_on, endsOn: data.ends_on }
        : null;
    },
  });
}

export interface MarksCheck {
  paperId: string;
  examId: string;
  classSectionId: string;
  schoolId: string;
  subject: Subject;
  heldOn: string;
  compared: number;
  highMarks: number;
  highButWeak: number;
  lowButStrong: number;
  flagged: boolean;
}

/** For CRPs: how the marks of each language paper compare with Pulse. */
export function marksChecksQuery() {
  return queryOptions({
    queryKey: marksChecksKey(),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MarksCheck[]> => {
      // Papers of the last six months: older marks no longer call for a conversation.
      const since = new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) - 183 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await getSupabase().rpc('exam_marks_checks', { since });
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        paperId: row.paper_id,
        examId: row.exam_id,
        classSectionId: row.class_section_id,
        schoolId: row.school_id,
        subject: oneOf(SUBJECTS, row.subject, 'other'),
        heldOn: row.held_on,
        compared: row.compared,
        highMarks: row.high_marks,
        highButWeak: row.high_but_weak,
        lowButStrong: row.low_but_strong,
        flagged: row.flagged,
      }));
    },
  });
}

export type PulseLevelSource = 'review' | 'engine' | 'teacher';

export interface MarksPulsePair {
  studentId: string;
  percent: number | null;
  pulseLevel: string;
  source: PulseLevelSource;
  checkId: string;
}

/** For CRPs: each child's mark in a paper beside what Pulse heard of them. */
export function marksPulseQuery(paperId: string) {
  return queryOptions({
    queryKey: ['marks-pulse', paperId],
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MarksPulsePair[]> => {
      const { data, error } = await getSupabase().rpc('exam_marks_pulse', {
        target_paper_id: paperId,
      });
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        studentId: row.student_id,
        percent: row.percent,
        pulseLevel: row.pulse_level,
        source: row.source === 'review' || row.source === 'engine' ? row.source : 'teacher',
        checkId: row.check_id,
      }));
    },
  });
}

/** Runs a change, telling the person when it could be neither kept nor sent. */
function useKeep() {
  const { t } = useTranslation();
  return useCallback(
    async (run: () => Promise<void>): Promise<boolean> => {
      try {
        await run();
        return true;
      } catch {
        toast.error(t('exams.saveFailed'));
        return false;
      }
    },
    [t],
  );
}

/** The exam as the lists show it before the server has it. */
function shownExam(exam: Exam, createdBy: string): ExamSummary {
  return {
    id: exam.id,
    academicYearId: exam.academicYearId,
    kind: exam.kind,
    title: exam.title,
    clusterId: exam.clusterId,
    schoolId: exam.schoolId,
    startsOn: exam.startsOn,
    endsOn: exam.endsOn,
    createdBy,
  };
}

function shownPapers(exam: Exam, schoolOf: (classSectionId: string) => string): StoredPaper[] {
  return exam.papers.map((paper) => ({
    id: paper.id,
    examId: exam.id,
    classSectionId: paper.classSectionId,
    schoolId: schoolOf(paper.classSectionId),
    subject: paper.subject,
    subjectName: paper.subjectName,
    heldOn: paper.heldOn,
    scale: paper.scale,
    maxMarks: paper.maxMarks,
    revision: 0,
    clientChangeId: null,
    results: 0,
  }));
}

/**
 * Schedules an exam, or changes one the person scheduled. It shows in the lists at once, also
 * without a network, so that it is not scheduled twice and its marks can be entered offline.
 */
export function useSaveExam() {
  const queryClient = useQueryClient();
  const keep = useKeep();
  const { t } = useTranslation();
  return useCallback(
    async (exam: Exam, createdBy: string, schoolOf: (classSectionId: string) => string) => {
      const summary = shownExam(exam, createdBy);
      const papers = shownPapers(exam, schoolOf);
      for (const classId of new Set(papers.map((paper) => paper.classSectionId))) {
        queryClient.setQueryData<ClassPaper[]>(classExamsKey(classId), (current) => [
          ...papers
            .filter((paper) => paper.classSectionId === classId)
            .map((paper) => ({ ...paper, exam: summary })),
          ...(current ?? []).filter((paper) => paper.examId !== exam.id),
        ]);
      }
      queryClient.setQueryData<ClusterExam[]>(clusterExamsKey(), (current) =>
        current
          ? [{ ...summary, papers }, ...current.filter((entry) => entry.id !== exam.id)]
          : current,
      );
      const kept = await keep(() =>
        keepOrSend(examSaveChange.kind, exam, examDedupeKey(exam.id), async () => {
          await examSaveChange.send(exam, {
            supabase: getSupabase(),
            readFile: () => Promise.reject(new Error('No files.')),
          });
          for (const key of examSaveChange.invalidates(exam)) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }),
      );
      if (kept) {
        toast.success(t('exams.schedule.kept'));
      } else {
        for (const key of examSaveChange.invalidates(exam)) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
      return kept;
    },
    [keep, queryClient, t],
  );
}

/** Removes an exam that has no marks yet; it disappears from the lists at once. */
export function useRemoveExam() {
  const queryClient = useQueryClient();
  const keep = useKeep();
  return useCallback(
    (change: ExamRemoveChange) => {
      for (const classId of change.classSectionIds) {
        queryClient.setQueryData<ClassPaper[]>(classExamsKey(classId), (papers) =>
          papers?.filter((paper) => paper.examId !== change.examId),
        );
      }
      queryClient.setQueryData<ClusterExam[]>(clusterExamsKey(), (exams) =>
        exams?.filter((exam) => exam.id !== change.examId),
      );
      return keep(() =>
        keepOrSend(examRemoveChange.kind, change, examDedupeKey(change.examId), async () => {
          await examRemoveChange.send(change, {
            supabase: getSupabase(),
            readFile: () => Promise.reject(new Error('No files.')),
          });
          for (const key of examRemoveChange.invalidates(change)) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }),
      );
    },
    [keep, queryClient],
  );
}

/** Moves a paper to another day, or changes its maximum; shown at once. */
export function useMovePaper() {
  const queryClient = useQueryClient();
  const keep = useKeep();
  return useCallback(
    (change: PaperMoveChange) => {
      queryClient.setQueryData<ClassPaper[]>(classExamsKey(change.classSectionId), (papers) =>
        papers?.map((paper) =>
          paper.id === change.paperId
            ? {
                ...paper,
                heldOn: change.heldOn,
                maxMarks: change.maxMarks ?? paper.maxMarks,
              }
            : paper,
        ),
      );
      return keep(() =>
        keepOrSend(paperMoveChange.kind, change, paperDedupeKey(change.paperId), async () => {
          await paperMoveChange.send(change, {
            supabase: getSupabase(),
            readFile: () => Promise.reject(new Error('No files.')),
          });
          for (const key of paperMoveChange.invalidates(change)) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }),
      );
    },
    [keep, queryClient],
  );
}

/**
 * Saves a paper's marks on the phone and sends them when it can. The marks show at once as the
 * paper's marks; resolves to whether they were kept.
 */
export function useSaveMarks() {
  const queryClient = useQueryClient();
  const keep = useKeep();
  return useCallback(
    async (
      paper: Parameters<typeof nextMarksChange>[1],
      entries: MarksChange['entries'],
      label: MarksChange['classLabel'],
    ) => {
      const change = nextMarksChange(queryClient, paper, entries, label);
      const now = new Date().toISOString();
      const before = {
        marks: queryClient.getQueryData<PaperMarks | null>(paperMarksKey(paper.id)),
        papers: queryClient.getQueryData<ClassPaper[]>(classExamsKey(paper.classSectionId)),
      };
      queryClient.setQueryData<PaperMarks | null>(paperMarksKey(paper.id), (current) => ({
        revision: current?.revision ?? paper.revision,
        clientChangeId: current?.clientChangeId ?? null,
        marks: entries.map((entry) => ({ ...entry, updatedAt: now })),
      }));
      queryClient.setQueryData<ClassPaper[]>(classExamsKey(paper.classSectionId), (papers) =>
        papers?.map((entry) =>
          entry.id === paper.id ? { ...entry, results: entries.length } : entry,
        ),
      );
      const kept = await keep(() =>
        keepOrSend(marksChange.kind, change, marksDedupeKey(paper.id), async () => {
          const revision = await sendMarks(change, getSupabase());
          marksChange.onSent?.(change, revision, queryClient);
          for (const key of marksChange.invalidates(change)) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        }),
      );
      if (!kept) {
        // Neither kept nor sent: the page shows again what it showed before.
        queryClient.setQueryData(paperMarksKey(paper.id), before.marks);
        queryClient.setQueryData(classExamsKey(paper.classSectionId), before.papers);
      }
      return kept;
    },
    [keep, queryClient],
  );
}
