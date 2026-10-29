import { queryOptions } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { readingLevelOf, type ReadingLevel } from './progress';

/**
 * Progress as the database reports it. A child's and a class's progress are read with the
 * caller's own rights; an office's report holds only totals over enough classes, schools and CRPs
 * that none of them can be made out.
 */

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function count(value: unknown): number {
  return numberOr(value, 0) ?? 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ---------------------------------------------------------------------------------------------
// A child
// ---------------------------------------------------------------------------------------------

export interface ChildProgress {
  student: { id: string; fullName: string; studentCode: string };
  pulse: {
    month: string;
    grade: number;
    reading: ReadingLevel | null;
    english: string;
    source: 'review' | 'engine' | 'teacher';
    wcpm: number | null;
  }[];
  marks: {
    heldOn: string;
    subject: string;
    subjectName: string | null;
    examKind: string;
    examTitle: string | null;
    absent: boolean;
    percent: number | null;
  }[];
  attendance: { month: string; marked: number; present: number }[];
}

export const childProgressKey = (studentId: string) => ['child-progress', studentId] as const;

export function childProgressQuery(studentId: string) {
  return queryOptions({
    queryKey: childProgressKey(studentId),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ChildProgress | null> => {
      const { data, error } = await getSupabase().rpc('child_progress', {
        target_student_id: studentId,
      });
      if (error) {
        throw error;
      }
      if (data === null) {
        return null;
      }
      const body = record(data);
      const student = record(body.student);
      return {
        student: {
          id: text(student.id),
          fullName: text(student.full_name),
          studentCode: text(student.student_code),
        },
        pulse: list(body.pulse).map((row) => ({
          month: text(row.month),
          grade: count(row.grade),
          reading: readingLevelOf(row.reading),
          english: text(row.english),
          source:
            row.source === 'review' ? 'review' : row.source === 'engine' ? 'engine' : 'teacher',
          wcpm: numberOr(row.wcpm, null),
        })),
        marks: list(body.marks).map((row) => ({
          heldOn: text(row.held_on),
          subject: text(row.subject),
          subjectName: typeof row.subject_name === 'string' ? row.subject_name : null,
          examKind: text(row.exam_kind),
          examTitle: typeof row.exam_title === 'string' ? row.exam_title : null,
          absent: row.absent === true,
          percent: numberOr(row.percent, null),
        })),
        attendance: list(body.attendance).map((row) => ({
          month: text(row.month),
          marked: count(row.marked),
          present: count(row.present),
        })),
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// A class
// ---------------------------------------------------------------------------------------------

export interface ClassProgress {
  grade: number;
  months: {
    month: string;
    checked: number;
    fluent: number;
    hesitant: number;
    needsSupport: number;
  }[];
  children: {
    studentId: string;
    fullName: string;
    latest: ReadingLevel | null;
    latestMonth: string | null;
    previous: ReadingLevel | null;
    wcpm: number | null;
    daysMarked: number;
    daysPresent: number;
    marksPercent: number | null;
  }[];
}

export const classProgressKey = (classSectionId: string) =>
  ['class-progress', classSectionId] as const;

export function classProgressQuery(classSectionId: string) {
  return queryOptions({
    queryKey: classProgressKey(classSectionId),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClassProgress | null> => {
      const { data, error } = await getSupabase().rpc('class_progress', {
        target_class_section_id: classSectionId,
      });
      if (error) {
        throw error;
      }
      if (data === null) {
        return null;
      }
      const body = record(data);
      return {
        grade: count(body.grade),
        months: list(body.months).map((row) => ({
          month: text(row.month),
          checked: count(row.checked),
          fluent: count(row.fluent),
          hesitant: count(row.hesitant),
          needsSupport: count(row.needs_support),
        })),
        children: list(body.children).map((row) => ({
          studentId: text(row.student_id),
          fullName: text(row.full_name),
          latest: readingLevelOf(row.latest),
          latestMonth: typeof row.latest_month === 'string' ? row.latest_month : null,
          previous: readingLevelOf(row.previous),
          wcpm: numberOr(row.wcpm, null),
          daysMarked: count(row.days_marked),
          daysPresent: count(row.days_present),
          marksPercent: numberOr(row.marks_percent, null),
        })),
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// An office's area
// ---------------------------------------------------------------------------------------------

export interface AreaCoachingMonth {
  month: string;
  /** Each figure is null when it would come from too few classes, schools or CRPs. */
  visitsDone: { visits: number; classes: number } | null;
  followUps: { practised: number; partly: number; notYet: number } | null;
  feedbackScore: { average: number } | null;
  timeToFeedback: { medianMinutes: number } | null;
}

export interface AreaSpeed {
  /** Children timed by the engine, including those who did not reach the passage. */
  timed: number;
  medianWcpm: number | null;
  atLakshya: number;
  lakshya: number;
}

export type AreaPulseMonth =
  | { month: string; grade: number; language: string; withheld: true }
  | {
      month: string;
      grade: number;
      language: string;
      withheld: false;
      classes: number;
      checked: number;
      needsSupport: number;
      hesitant: number;
      fluent: number;
      independent: number;
      speed: AreaSpeed | null;
    };

export interface AreaReport {
  /** A figure is shown only from at least this many classes, schools and (mentoring) CRPs. */
  fewestClasses: number;
  fewestSchools: number;
  fewestCrps: number;
  /** The last finished month, `YYYY-MM-01`; the month in progress is never shown. */
  lastMonth: string;
  schools: number;
  classes: number;
  coaching: AreaCoachingMonth[];
  pulse: AreaPulseMonth[];
}

/** The figures of an office's report, read from what the database returns. */
export function toAreaReport(data: unknown): AreaReport | null {
  if (data === null || data === undefined) {
    return null;
  }
  const body = record(data);
  const optional = <Result>(value: unknown, read: (row: Record<string, unknown>) => Result) =>
    value === null || value === undefined ? null : read(record(value));
  return {
    fewestClasses: count(body.fewest_classes) || 5,
    fewestSchools: count(body.fewest_schools) || 3,
    fewestCrps: count(body.fewest_crps) || 2,
    lastMonth: text(body.last_month),
    schools: count(body.schools),
    classes: count(body.classes),
    coaching: list(body.coaching).map((row) => ({
      month: text(row.month),
      visitsDone: optional(row.visits_done, (value) => ({
        visits: count(value.visits),
        classes: count(value.classes),
      })),
      followUps: optional(row.follow_ups, (value) => ({
        practised: count(value.practised),
        partly: count(value.partly),
        notYet: count(value.not_yet),
      })),
      feedbackScore: optional(row.feedback_score, (value) => ({ average: count(value.average) })),
      timeToFeedback: optional(row.time_to_feedback, (value) => ({
        medianMinutes: count(value.median_minutes),
      })),
    })),
    pulse: list(body.pulse).map((row): AreaPulseMonth => {
      const key = { month: text(row.month), grade: count(row.grade), language: text(row.language) };
      return row.withheld === false
        ? {
            ...key,
            withheld: false,
            classes: count(row.classes),
            checked: count(row.checked),
            needsSupport: count(row.needs_support),
            hesitant: count(row.hesitant),
            fluent: count(row.fluent),
            independent: count(row.independent),
            speed: optional(row.speed, (value) => ({
              timed: count(value.timed),
              medianWcpm: numberOr(value.median_wcpm, null),
              atLakshya: count(value.at_lakshya),
              lakshya: count(value.lakshya),
            })),
          }
        : { ...key, withheld: true };
    }),
  };
}

export const areaReportKey = () => ['area-report'] as const;

export function areaReportQuery() {
  return queryOptions({
    queryKey: areaReportKey(),
    meta: { persist: true },
    staleTime: 15 * 60_000,
    queryFn: async (): Promise<AreaReport | null> => {
      const { data, error } = await getSupabase().rpc('area_report', { month_count: 6 });
      if (error) {
        throw error;
      }
      return toAreaReport(data);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// The CRP's own scores
// ---------------------------------------------------------------------------------------------

export const myScoresKey = () => ['my-feedback-scores'] as const;

/**
 * The CRP's own feedback scores of the last six months, by visit: the total, and when the
 * feedback it scored was agreed.
 */
export function myScoresQuery(since: string) {
  return queryOptions({
    queryKey: [...myScoresKey(), since] as const,
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ visitId: string; total: number; feedbackAgreedAt: string }[]> => {
      const { data, error } = await getSupabase()
        .from('visit_feedback_scores')
        .select('visit_id, total, feedback_agreed_at')
        .gte('feedback_agreed_at', since)
        .order('feedback_agreed_at', { ascending: false })
        .limit(1000);
      if (error) {
        throw error;
      }
      return data.flatMap((row) =>
        row.total === null
          ? []
          : [{ visitId: row.visit_id, total: row.total, feedbackAgreedAt: row.feedback_agreed_at }],
      );
    },
  });
}
