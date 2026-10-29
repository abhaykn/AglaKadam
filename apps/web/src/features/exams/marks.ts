/**
 * Marks as teachers type them, checked and summarised on the phone. The database applies the same
 * rules; checking here lets the teacher fix a slip before saving, also without a network.
 */

export const GRADES = ['A', 'B', 'C', 'D', 'E'] as const;
export type Grade = (typeof GRADES)[number];

/** Grades count at the middle of their band: A from 80 %, B from 60 %, C from 40 %, D from 20 %. */
export const GRADE_PERCENT: Record<Grade, number> = { A: 90, B: 70, C: 50, D: 30, E: 10 };

/** How a paper is marked. */
export interface PaperScale {
  scale: 'marks' | 'grades';
  maxMarks: number | null;
}

/** A child's result in a paper. */
export interface MarkEntry {
  studentId: string;
  marks: number | null;
  grade: Grade | null;
  absent: boolean;
}

export type MarksProblem = 'format' | 'step' | 'range';

/**
 * Reads typed marks: a number from 0 to the paper's maximum, in steps of a half. An empty field is
 * no mark yet.
 */
export function parseMarks(
  text: string,
  maxMarks: number,
): { value: number | null } | { problem: MarksProblem } {
  // Devanagari digits, as many phones type them in Hindi, count like the others.
  const typed = text
    .trim()
    .replace(',', '.')
    .replace(/[\u0966-\u096F]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
  if (typed === '') {
    return { value: null };
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(typed)) {
    return { problem: 'format' };
  }
  const value = Number(typed);
  if (value * 2 !== Math.round(value * 2)) {
    return { problem: 'step' };
  }
  if (value > maxMarks) {
    return { problem: 'range' };
  }
  return { value };
}

/** A result as a share of the paper's maximum, in percent; null when there is none. */
export function percentOf(entry: MarkEntry, paper: PaperScale): number | null {
  if (entry.absent) {
    return null;
  }
  if (paper.scale === 'marks') {
    return entry.marks === null || !paper.maxMarks
      ? null
      : Math.round((entry.marks * 1000) / paper.maxMarks) / 10;
  }
  return entry.grade ? GRADE_PERCENT[entry.grade] : null;
}

/** Whether an entry holds a result the server accepts: marks, a grade, or absent. */
export function isComplete(entry: MarkEntry, paper: PaperScale): boolean {
  if (entry.absent) {
    return true;
  }
  return paper.scale === 'marks'
    ? entry.marks !== null && paper.maxMarks !== null && entry.marks <= paper.maxMarks
    : entry.grade !== null;
}

export interface MarksSummary {
  /** Children on the roll of the paper's day. */
  children: number;
  entered: number;
  absent: number;
  /** Mean share of the maximum of those who sat the paper, in percent. */
  average: number | null;
  highest: number | null;
  lowest: number | null;
}

/** What a paper's results come to, over the children on its roll. */
export function summarise(
  entries: readonly MarkEntry[],
  roll: readonly string[],
  paper: PaperScale,
): MarksSummary {
  const onRoll = new Set(roll);
  const counted = entries.filter(
    (entry) => onRoll.has(entry.studentId) && isComplete(entry, paper),
  );
  const shares = counted
    .map((entry) => percentOf(entry, paper))
    .filter((share): share is number => share !== null);
  return {
    children: onRoll.size,
    entered: counted.length,
    absent: counted.filter((entry) => entry.absent).length,
    average:
      shares.length > 0
        ? Math.round((shares.reduce((sum, share) => sum + share, 0) * 10) / shares.length) / 10
        : null,
    highest: shares.length > 0 ? Math.max(...shares) : null,
    lowest: shares.length > 0 ? Math.min(...shares) : null,
  };
}

/** A mark for display: "17.5", or "17" for a whole number. */
export function formatMarks(marks: number, language: string): string {
  return new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    maximumFractionDigits: 1,
  }).format(marks);
}
