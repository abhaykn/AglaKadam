import type { ExamResultPaper } from './exam-api';
import type { MarkEntry } from './marks';

export interface SheetRow {
  studentId: string;
  name: string;
  results: (MarkEntry | null)[];
  /** Marks over the papers marked out of a maximum that the child sat. */
  total: number | null;
  outOf: number | null;
  percent: number | null;
}

/**
 * The rows of a result sheet: every child on the class's roll during the exam, or with a result,
 * with their result in each paper and the total of the papers marked out of a maximum.
 */
export function sheetRows(
  papers: readonly ExamResultPaper[],
  children: readonly { studentId: string; name: string }[],
): SheetRow[] {
  return children.map((child) => {
    const results = papers.map(
      (paper) => paper.marks.find((mark) => mark.studentId === child.studentId) ?? null,
    );
    let total = 0;
    let outOf = 0;
    papers.forEach((paper, index) => {
      const result = results[index];
      const marks = result && !result.absent ? result.marks : null;
      if (paper.scale === 'marks' && paper.maxMarks && marks !== null) {
        total += marks;
        outOf += paper.maxMarks;
      }
    });
    return {
      studentId: child.studentId,
      name: child.name,
      results,
      total: outOf > 0 ? total : null,
      outOf: outOf > 0 ? outOf : null,
      percent: outOf > 0 ? Math.round((total * 1000) / outOf) / 10 : null,
    };
  });
}
