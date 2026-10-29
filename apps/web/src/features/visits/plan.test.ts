import { describe, expect, it } from 'vitest';
import {
  addDays,
  bySchool,
  daysBetween,
  planWeek,
  plannedDays,
  rankClass,
  rankClasses,
  WEIGHTS,
  workingDaysFrom,
  type ClassSignal,
} from './plan';

// A Wednesday.
const TODAY = '2026-10-21';

function signal(overrides: Partial<ClassSignal> = {}): ClassSignal {
  return {
    classSectionId: 'class-1',
    schoolId: 'school-1',
    grade: 2,
    section: 'A',
    medium: 'hi',
    pulseMonth: '2026-10-01',
    pulseChecked: 10,
    needsSupport: 0,
    hesitant: 4,
    fluent: 6,
    englishNoResponse: 0,
    toListen: 0,
    lastVisitOn: '2026-10-11',
    visitsThisYear: 2,
    checkBackOn: null,
    checkBackVisitId: null,
    requestTopic: null,
    requestedAt: null,
    marksToDiscuss: 0,
    ...overrides,
  };
}

describe('dates of the plan', () => {
  it('lists each later day a visit is planned on after the days of the week', () => {
    const week = planWeek(TODAY);
    expect(
      plannedDays(week, ['2026-10-22', '2026-10-29', '2026-10-27', '2026-10-29', '2026-10-12']),
    ).toEqual([...week.days, '2026-10-27', '2026-10-29']);
    expect(plannedDays(week, [])).toEqual(week.days);
  });

  it('plans Monday to Saturday, and the coming week on a Sunday', () => {
    expect(planWeek(TODAY)).toMatchObject({ start: '2026-10-19', end: '2026-10-24' });
    expect(planWeek('2026-10-25').start).toBe('2026-10-26');
    expect(planWeek('2026-10-26').start).toBe('2026-10-26');
    expect(planWeek(TODAY).days).toHaveLength(6);
    expect(daysBetween('2026-10-11', TODAY)).toBe(10);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    // From a Saturday: Saturday, then Monday onwards.
    expect(workingDaysFrom('2026-10-24', 3)).toEqual(['2026-10-24', '2026-10-26', '2026-10-27']);
  });
});

describe('ranking a class', () => {
  it('scores by the share of children needing support', () => {
    const ranked = rankClass(signal({ needsSupport: 5, fluent: 1 }), [], TODAY);
    // Half the class: 20 points; ten days since the visit: 5 points.
    expect(ranked.score).toBe(WEIGHTS.readingGap / 2 + 5);
    expect(ranked.reasons).toEqual([
      { kind: 'readingGap', needsSupport: 5, checked: 10 },
      { kind: 'notVisited', days: 10 },
    ]);
  });

  it('ignores a Pulse with too few children checked', () => {
    const ranked = rankClass(signal({ pulseChecked: 2, needsSupport: 2 }), [], TODAY);
    expect(ranked.reasons.map((reason) => reason.kind)).toEqual(['notVisited']);
  });

  it('puts a due check-back first, more so when it is overdue', () => {
    const due = rankClass(signal({ checkBackOn: '2026-10-23' }), [], TODAY);
    const overdue = rankClass(signal({ checkBackOn: '2026-10-19' }), [], TODAY);
    const later = rankClass(signal({ checkBackOn: '2026-11-04' }), [], TODAY);
    expect(due.reasons[0]).toEqual({ kind: 'checkBack', on: '2026-10-23', overdue: false });
    expect(overdue.score - due.score).toBe(WEIGHTS.checkBackOverdue - WEIGHTS.checkBackDue);
    expect(later.reasons.some((reason) => reason.kind === 'checkBack')).toBe(false);
  });

  it('counts a request, a class never visited and a task due at the school', () => {
    const ranked = rankClass(
      signal({ lastVisitOn: null, requestTopic: 'english' }),
      [
        { schoolId: 'school-1', dueOn: '2026-10-22', done: false },
        { schoolId: 'school-1', dueOn: '2026-10-22', done: true },
        { schoolId: 'school-2', dueOn: '2026-10-22', done: false },
        { schoolId: 'school-1', dueOn: '2026-11-30', done: false },
      ],
      TODAY,
    );
    expect(ranked.score).toBe(WEIGHTS.request + WEIGHTS.neverVisited + WEIGHTS.taskDue);
    expect(ranked.reasons).toEqual([
      { kind: 'request', topic: 'english' },
      { kind: 'notVisited', days: null },
      { kind: 'taskDue', count: 1 },
    ]);
    expect(ranked.band).toBe('medium');
  });

  it('lets a class just visited drop back, unless its check-back is due', () => {
    const recent = rankClass(signal({ lastVisitOn: '2026-10-19', needsSupport: 8 }), [], TODAY);
    expect(recent.reasons).toContainEqual({ kind: 'visitedRecently', days: 2 });
    expect(recent.score).toBe(Math.round(WEIGHTS.readingGap * 0.8) + WEIGHTS.visitedRecently);
    const followUp = rankClass(
      signal({ lastVisitOn: '2026-10-19', checkBackOn: '2026-10-24' }),
      [],
      TODAY,
    );
    expect(followUp.reasons.some((reason) => reason.kind === 'visitedRecently')).toBe(false);
    // A check-back agreed for weeks later does not keep a class just visited at the top.
    const coached = rankClass(
      signal({ lastVisitOn: '2026-10-19', needsSupport: 8, checkBackOn: '2026-11-02' }),
      [],
      TODAY,
    );
    expect(coached.reasons).toContainEqual({ kind: 'visitedRecently', days: 2 });
    expect(coached.score).toBe(Math.round(WEIGHTS.readingGap * 0.8) + WEIGHTS.visitedRecently);
  });

  it('counts recent marks that Pulse does not bear out', () => {
    const plain = rankClass(signal(), [], TODAY);
    const doubted = rankClass(signal({ marksToDiscuss: 2 }), [], TODAY);
    expect(doubted.score - plain.score).toBe(WEIGHTS.marksCheck);
    expect(doubted.reasons).toContainEqual({ kind: 'marksCheck', count: 2 });
  });

  it('keeps the score between 0 and 100', () => {
    expect(rankClass(signal({ lastVisitOn: '2026-10-20' }), [], TODAY).score).toBe(0);
    const everything = rankClass(
      signal({
        needsSupport: 10,
        englishNoResponse: 10,
        lastVisitOn: null,
        requestTopic: 'reading',
        checkBackOn: '2026-10-01',
      }),
      [{ schoolId: 'school-1', dueOn: '2026-10-21', done: false }],
      TODAY,
    );
    expect(everything.score).toBe(100);
  });
});

describe('the ranked plan', () => {
  it('orders classes by score, then by the longest wait, and groups them by school', () => {
    const ranked = rankClasses(
      [
        signal({ classSectionId: 'a', schoolId: 's1', lastVisitOn: '2026-10-01' }),
        signal({ classSectionId: 'b', schoolId: 's2', needsSupport: 6 }),
        signal({ classSectionId: 'c', schoolId: 's1', lastVisitOn: '2026-09-21' }),
        signal({ classSectionId: 'd', schoolId: 's3', lastVisitOn: '2026-09-21' }),
      ],
      [],
      TODAY,
    );
    expect(ranked.map((entry) => entry.signal.classSectionId)).toEqual(['b', 'c', 'd', 'a']);
    expect(bySchool(ranked).map((school) => [school.schoolId, school.classes.length])).toEqual([
      ['s2', 1],
      ['s1', 2],
      ['s3', 1],
    ]);
  });
});
