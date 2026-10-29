import type { ExamKind, Subject } from '@/features/exams/exam-change';
import { percentOf, type Grade } from '@/features/exams/marks';

/**
 * A child's own results as the family sees them: only exams whose result the school has shared,
 * grouped by exam, with the same totals as the school's result sheet.
 */

export interface ChildResult {
  paperId: string;
  subject: Subject;
  subjectName: string | null;
  heldOn: string;
  scale: 'marks' | 'grades';
  maxMarks: number | null;
  marks: number | null;
  grade: Grade | null;
  absent: boolean;
}

export interface ChildExam {
  id: string;
  kind: ExamKind;
  title: string;
  startsOn: string;
  endsOn: string;
  papers: ChildResult[];
  /** Marks over the papers marked out of a maximum that the child sat, as on the result sheet. */
  total: number | null;
  outOf: number | null;
  percent: number | null;
}

export interface ChildResultRow extends ChildResult {
  exam: Pick<ChildExam, 'id' | 'kind' | 'title' | 'startsOn' | 'endsOn'>;
}

/** The exams of a child's results, the latest first, each with its papers in the order held. */
export function childExams(rows: readonly ChildResultRow[]): ChildExam[] {
  const exams = new Map<string, ChildExam>();
  for (const { exam, ...result } of rows) {
    const held = exams.get(exam.id) ?? {
      ...exam,
      papers: [],
      total: null,
      outOf: null,
      percent: null,
    };
    held.papers.push(result);
    exams.set(exam.id, held);
  }
  return [...exams.values()]
    .map((exam) => {
      const papers = [...exam.papers].sort(
        (a, b) => a.heldOn.localeCompare(b.heldOn) || a.subject.localeCompare(b.subject),
      );
      let total = 0;
      let outOf = 0;
      for (const paper of papers) {
        if (paper.scale === 'marks' && paper.maxMarks && !paper.absent && paper.marks !== null) {
          total += paper.marks;
          outOf += paper.maxMarks;
        }
      }
      return {
        ...exam,
        papers,
        total: outOf > 0 ? total : null,
        outOf: outOf > 0 ? outOf : null,
        percent: outOf > 0 ? Math.round((total * 1000) / outOf) / 10 : null,
      };
    })
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn) || a.id.localeCompare(b.id));
}

/** A result as a share of the paper's maximum, in percent; null when absent. */
export function resultPercent(result: ChildResult): number | null {
  return percentOf(
    { studentId: '', marks: result.marks, grade: result.grade, absent: result.absent },
    result,
  );
}

/**
 * Stars from one to five, by the school's grade bands: A (80 % and above) is five stars, B (60 %)
 * four, C (40 %) three, D (20 %) two, and E one. A grade gives its band directly.
 */
export function starsOf(result: Pick<ChildResult, 'grade' | 'absent'>, percent: number | null) {
  if (result.absent) {
    return null;
  }
  if (result.grade) {
    return { A: 5, B: 4, C: 3, D: 2, E: 1 }[result.grade];
  }
  return percent === null ? null : starsForPercent(percent);
}

export function starsForPercent(percent: number): number {
  if (percent >= 80) {
    return 5;
  }
  if (percent >= 60) {
    return 4;
  }
  if (percent >= 40) {
    return 3;
  }
  return percent >= 20 ? 2 : 1;
}

/** The subjects of an exam in which the child would gain most from practice at home. */
export function practiceSubjects(exam: ChildExam): Subject[] {
  return [
    ...new Set(
      exam.papers
        .filter((paper) => {
          const stars = starsOf(paper, resultPercent(paper));
          return stars !== null && stars <= 2;
        })
        .map((paper) => paper.subject),
    ),
  ];
}
