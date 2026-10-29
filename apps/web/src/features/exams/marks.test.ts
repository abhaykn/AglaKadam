import { describe, expect, it } from 'vitest';
import { initialiseI18n } from '@/i18n';
import en from '@/i18n/locales/en.json';
import { marksOpen } from './exam-change';
import { examReasonFor } from './exam-reasons';
import { isComplete, parseMarks, percentOf, summarise, type MarkEntry } from './marks';
import { sheetRows } from './result-sheet';

const OUT_OF_20 = { scale: 'marks', maxMarks: 20 } as const;
const GRADED = { scale: 'grades', maxMarks: null } as const;

function entry(studentId: string, values: Partial<MarkEntry> = {}): MarkEntry {
  return { studentId, marks: null, grade: null, absent: false, ...values };
}

describe('typed marks', () => {
  it('take numbers up to the maximum, in steps of a half', () => {
    expect(parseMarks('14', 20)).toEqual({ value: 14 });
    expect(parseMarks(' 14.5 ', 20)).toEqual({ value: 14.5 });
    expect(parseMarks('14,5', 20)).toEqual({ value: 14.5 });
    // Devanagari digits, as Hindi keyboards type them.
    expect(parseMarks('१५', 20)).toEqual({ value: 15 });
    expect(parseMarks('', 20)).toEqual({ value: null });
    expect(parseMarks('0', 20)).toEqual({ value: 0 });
    expect(parseMarks('20', 20)).toEqual({ value: 20 });
    expect(parseMarks('21', 20)).toEqual({ problem: 'range' });
    expect(parseMarks('14.25', 20)).toEqual({ problem: 'step' });
    expect(parseMarks('-1', 20)).toEqual({ problem: 'format' });
    expect(parseMarks('fourteen', 20)).toEqual({ problem: 'format' });
    expect(parseMarks('1e1', 20)).toEqual({ problem: 'format' });
  });

  it('count as a share of the maximum, and grades at the middle of their band', () => {
    expect(percentOf(entry('a', { marks: 15 }), OUT_OF_20)).toBe(75);
    expect(percentOf(entry('a', { marks: 17.5 }), OUT_OF_20)).toBe(87.5);
    expect(percentOf(entry('a', { absent: true }), OUT_OF_20)).toBeNull();
    expect(percentOf(entry('a', { grade: 'B' }), GRADED)).toBe(70);
    expect(isComplete(entry('a'), OUT_OF_20)).toBe(false);
    expect(isComplete(entry('a', { absent: true }), GRADED)).toBe(true);
    expect(isComplete(entry('a', { marks: 25 }), OUT_OF_20)).toBe(false);
  });

  it('sum up a paper over the children on its roll', () => {
    const summary = summarise(
      [
        entry('a', { marks: 20 }),
        entry('b', { marks: 10 }),
        entry('c', { absent: true }),
        // A child no longer on the roll is not counted.
        entry('z', { marks: 1 }),
      ],
      ['a', 'b', 'c', 'd'],
      OUT_OF_20,
    );
    expect(summary).toEqual({
      children: 4,
      entered: 3,
      absent: 1,
      average: 75,
      highest: 100,
      lowest: 50,
    });
  });

  it('are entered from the day of the paper for 60 days', () => {
    expect(marksOpen('2026-10-21', '2026-10-21')).toBe(true);
    expect(marksOpen('2026-10-22', '2026-10-21')).toBe(false);
    expect(marksOpen('2026-08-22', '2026-10-21')).toBe(true);
    expect(marksOpen('2026-08-21', '2026-10-21')).toBe(false);
  });
});

describe('the result sheet', () => {
  it('totals the papers marked out of a maximum that each child sat', () => {
    const paper = (id: string, values: Record<string, unknown>) => ({
      id,
      examId: 'exam',
      classSectionId: 'class',
      schoolId: 'school',
      subject: 'maths' as const,
      subjectName: null,
      heldOn: '2026-10-21',
      revision: 1,
      clientChangeId: null,
      results: 2,
      scale: 'marks' as const,
      maxMarks: 50,
      marks: [] as MarkEntry[],
      ...values,
    });
    const rows = sheetRows(
      [
        paper('hindi', { marks: [entry('a', { marks: 40 }), entry('b', { absent: true })] }),
        paper('maths', {
          maxMarks: 100,
          marks: [entry('a', { marks: 80 }), entry('b', { marks: 30.5 })],
        }),
        paper('art', {
          scale: 'grades',
          maxMarks: null,
          marks: [entry('a', { grade: 'A' })],
        }),
      ],
      [
        { studentId: 'a', name: 'Asha' },
        { studentId: 'b', name: 'Bilal' },
        { studentId: 'c', name: 'Chetan' },
      ],
    );
    expect(rows.map((row) => [row.name, row.total, row.outOf, row.percent])).toEqual([
      ['Asha', 120, 150, 80],
      ['Bilal', 30.5, 100, 30.5],
      ['Chetan', null, null, null],
    ]);
    expect(rows[0]?.results[2]).toMatchObject({ grade: 'A' });
  });
});

describe('why marks were not accepted', () => {
  const t = initialiseI18n().getFixedT('en');

  it('names the refusals a teacher can act on', () => {
    const reason = (code: string, message: string) => examReasonFor({ code, message }, t);
    expect(reason('42501', 'Marks can be changed for 60 days after the paper.')).toBe(
      en.exams.refused.closed,
    );
    expect(reason('23514', "A mark is missing, out of range, or not of the paper's kind.")).toBe(
      en.exams.refused.invalid,
    );
    expect(reason('23514', 'A paper with marks cannot be removed.')).toBe(
      en.exams.refused.hasMarks,
    );
    expect(reason('network', '')).toBe(en.sync.reasons.network);
  });
});
