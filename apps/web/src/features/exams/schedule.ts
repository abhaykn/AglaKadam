import { EXAM_SPAN_DAYS, MARKS_WINDOW_DAYS, MAX_MARKS_LIMIT } from './exam-change';
import type { Exam, ExamKind, Subject } from './exam-change';

/**
 * An exam put together from what a teacher or CRP chose: one paper for each subject in each class,
 * checked against the same rules as the database, so that a slip is shown before anything is saved.
 */

export interface ScheduledSubject {
  subject: Subject;
  /** The name of an "other" subject. */
  subjectName: string;
  heldOn: string;
}

export interface ScheduleInput {
  examId: string;
  academicYear: { id: string; startsOn: string; endsOn: string } | null;
  kind: ExamKind;
  title: string;
  clusterId: string | null;
  schoolId: string | null;
  /** The classes the exam may cover. */
  classes: readonly { id: string; grade: number }[];
  /** The grades chosen; null takes every class given. */
  grades: readonly number[] | null;
  subjects: readonly ScheduledSubject[];
  scale: 'marks' | 'grades';
  maxMarks: string;
  today: string;
  newId: () => string;
}

export type ScheduleProblem =
  | 'noYear'
  | 'needSubject'
  | 'needOtherName'
  | 'needGrade'
  | 'datesInvalid'
  | 'maxInvalid'
  | 'tooMany';

/** The most papers one exam may have; a larger cluster schedules its grades in two exams. */
export const MAX_PAPERS = 600;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function buildExam(input: ScheduleInput): { exam: Exam } | { problem: ScheduleProblem } {
  const year = input.academicYear;
  if (!year) {
    return { problem: 'noYear' };
  }
  if (input.subjects.length === 0) {
    return { problem: 'needSubject' };
  }
  if (input.subjects.some((entry) => entry.subject === 'other' && !entry.subjectName.trim())) {
    return { problem: 'needOtherName' };
  }
  const classes =
    input.grades === null
      ? input.classes
      : input.classes.filter((entry) => input.grades?.includes(entry.grade));
  if (classes.length === 0) {
    return { problem: 'needGrade' };
  }
  if (classes.length * input.subjects.length > MAX_PAPERS) {
    return { problem: 'tooMany' };
  }
  const days = input.subjects.map((entry) => entry.heldOn).sort();
  const startsOn = days[0] ?? '';
  const endsOn = days[days.length - 1] ?? '';
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) ||
    startsOn < year.startsOn ||
    endsOn > year.endsOn ||
    daysBetween(startsOn, endsOn) > EXAM_SPAN_DAYS ||
    daysBetween(startsOn, input.today) > MARKS_WINDOW_DAYS
  ) {
    return { problem: 'datesInvalid' };
  }
  let maxMarks: number | null = null;
  if (input.scale === 'marks') {
    maxMarks = /^\d{1,3}$/.test(input.maxMarks.trim()) ? Number(input.maxMarks.trim()) : NaN;
    if (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > MAX_MARKS_LIMIT) {
      return { problem: 'maxInvalid' };
    }
  }
  return {
    exam: {
      id: input.examId,
      academicYearId: year.id,
      kind: input.kind,
      title: input.title.trim().slice(0, 80),
      clusterId: input.clusterId,
      schoolId: input.schoolId,
      startsOn,
      endsOn,
      papers: classes.flatMap((entry) =>
        input.subjects.map((subject) => ({
          id: input.newId(),
          classSectionId: entry.id,
          subject: subject.subject,
          subjectName: subject.subject === 'other' ? subject.subjectName.trim().slice(0, 40) : null,
          heldOn: subject.heldOn,
          scale: input.scale,
          maxMarks,
        })),
      ),
    },
  };
}
