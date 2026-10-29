import { describe, expect, it } from 'vitest';
import { sessionStart, summariseAttendance } from './attendance-summary';
import {
  childExams,
  practiceSubjects,
  resultPercent,
  starsOf,
  type ChildResultRow,
} from './results';

const unitTest = {
  id: '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901',
  kind: 'unit_test' as const,
  title: '',
  startsOn: '2026-09-14',
  endsOn: '2026-09-18',
};
const classTest = {
  id: '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f902',
  kind: 'class_test' as const,
  title: 'Class test 2',
  startsOn: '2026-10-05',
  endsOn: '2026-10-05',
};

function row(overrides: Partial<ChildResultRow>): ChildResultRow {
  return {
    paperId: crypto.randomUUID(),
    subject: 'hindi',
    subjectName: null,
    heldOn: '2026-09-14',
    scale: 'marks',
    maxMarks: 20,
    marks: 15,
    grade: null,
    absent: false,
    exam: unitTest,
    ...overrides,
  };
}

describe("a child's results", () => {
  it('groups papers by exam, the latest exam first, with the result sheet total', () => {
    const exams = childExams([
      row({ subject: 'maths', heldOn: '2026-09-16', marks: 9.5 }),
      row({ subject: 'hindi', heldOn: '2026-09-14', marks: 18 }),
      row({ subject: 'english', heldOn: '2026-09-15', absent: true, marks: null }),
      row({
        subject: 'evs',
        heldOn: '2026-09-17',
        scale: 'grades',
        maxMarks: null,
        marks: null,
        grade: 'B',
      }),
      row({ exam: classTest, heldOn: '2026-10-05', marks: 12, maxMarks: 25 }),
    ]);
    expect(exams.map((exam) => exam.id)).toEqual([classTest.id, unitTest.id]);
    const unit = exams[1];
    expect(unit?.papers.map((paper) => paper.subject)).toEqual([
      'hindi',
      'english',
      'maths',
      'evs',
    ]);
    // Absent papers and graded papers do not count towards the total.
    expect(unit).toMatchObject({ total: 27.5, outOf: 40, percent: 68.8 });
    expect(exams[0]).toMatchObject({ total: 12, outOf: 25, percent: 48 });
  });

  it('gives stars by the grade bands, and none for an absence', () => {
    expect(starsOf({ grade: null, absent: false }, 80)).toBe(5);
    expect(starsOf({ grade: null, absent: false }, 79.9)).toBe(4);
    expect(starsOf({ grade: null, absent: false }, 40)).toBe(3);
    expect(starsOf({ grade: null, absent: false }, 20)).toBe(2);
    expect(starsOf({ grade: null, absent: false }, 0)).toBe(1);
    expect(starsOf({ grade: 'C', absent: false }, 50)).toBe(3);
    expect(starsOf({ grade: null, absent: true }, null)).toBeNull();
    expect(resultPercent(row({ marks: 7, maxMarks: 20 }))).toBe(35);
  });

  it('points to the subjects that most need practice at home', () => {
    const [exam] = childExams([
      row({ subject: 'hindi', marks: 3 }),
      row({ subject: 'maths', marks: 19 }),
      row({ subject: 'english', absent: true, marks: null }),
    ]);
    expect(exam && practiceSubjects(exam)).toEqual(['hindi']);
  });
});

describe("a child's attendance", () => {
  it('counts marked days by month, the latest month first, and the run of present days', () => {
    const summary = summariseAttendance([
      { date: '2026-10-03', present: true },
      { date: '2026-09-29', present: false },
      { date: '2026-10-01', present: false },
      { date: '2026-10-02', present: true },
      { date: '2026-09-30', present: true },
    ]);
    expect(summary.months).toEqual([
      { month: '2026-10', marked: 3, present: 2, absentDays: ['2026-10-01'] },
      { month: '2026-09', marked: 2, present: 1, absentDays: ['2026-09-29'] },
    ]);
    expect(summary).toMatchObject({
      marked: 5,
      present: 3,
      percent: 60,
      streak: 2,
      latest: '2026-10-03',
    });
  });

  it('has no share or run without records', () => {
    expect(summariseAttendance([])).toMatchObject({ percent: null, streak: 0, latest: null });
  });

  it('starts the session in April', () => {
    expect(sessionStart('2026-10-21')).toBe('2026-04-01');
    expect(sessionStart('2027-02-10')).toBe('2026-04-01');
    expect(sessionStart('2027-04-01')).toBe('2027-04-01');
  });
});
