import { describe, expect, it } from 'vitest';
import { toAreaReport } from './progress-api';
import {
  coachingByMonth,
  lastMonths,
  median,
  minutesToFeedback,
  monthLabels,
  monthsSpanning,
  movementOf,
  percent,
  type CoachedVisit,
} from './progress';

function visit(overrides: Partial<CoachedVisit>): CoachedVisit {
  return {
    id: crypto.randomUUID(),
    crpId: 'crp-1',
    status: 'done',
    visitedOn: '2026-10-10',
    startedAt: '2026-10-10T04:00:00.000Z',
    followsVisitId: null,
    followUpResult: null,
    moments: [{ atSeconds: 1800 }],
    feedback: { agreedAt: '2026-10-10T05:00:00.000Z' },
    ...overrides,
  };
}

describe('months of a chart', () => {
  it('keeps a place for each month between the first and the last', () => {
    expect(monthsSpanning(['2026-09-01', '2026-07-01'])).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(monthsSpanning(['2026-11-01', '2027-01-01'])).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
    expect(monthsSpanning([])).toEqual([]);
  });
});

describe('progress over months', () => {
  it('names how a child moved between two checks', () => {
    expect(movementOf('needs_support', 'hesitant')).toBe('up');
    expect(movementOf('fluent', 'hesitant')).toBe('down');
    expect(movementOf('fluent', 'fluent')).toBe('same');
    expect(movementOf(null, 'fluent')).toBe('first');
    expect(movementOf('fluent', null)).toBeNull();
  });

  it('counts shares and middles, and lists months across a year end', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(1, 0)).toBeNull();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
    expect(lastMonths('2027-01-15', 3)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    // The year appears on every label once the months reach into two years.
    expect(monthLabels(['2026-09-01', '2026-10-01'], 'en')).toEqual(['Sept', 'Oct']);
    expect(monthLabels(['2026-12-01', '2027-01-01'], 'en')).toEqual(['Dec ’26', 'Jan ’27']);
  });

  it("measures time to feedback from the lesson's last moment", () => {
    expect(minutesToFeedback(visit({}))).toBe(30);
    // Without a moment noted the end of the lesson is not known.
    expect(minutesToFeedback(visit({ moments: [] }))).toBeNull();
    expect(minutesToFeedback(visit({ feedback: { agreedAt: null } }))).toBeNull();
    // Feedback agreed before the last moment noted counts as at once.
    expect(minutesToFeedback(visit({ moments: [{ atSeconds: 9000 }] }))).toBe(0);
  });

  it("summarises only the CRP's own visits, month by month", () => {
    const followed = visit({ visitedOn: '2026-09-20' });
    const agreedAgain = visit({ feedback: { agreedAt: '2026-10-10T06:00:00.000Z' } });
    const visits = [
      followed,
      agreedAgain,
      visit({ followsVisitId: followed.id, followUpResult: 'practised' }),
      visit({ followsVisitId: followed.id, followUpResult: 'partly' }),
      visit({ crpId: 'crp-2', followsVisitId: followed.id, followUpResult: 'practised' }),
      visit({ status: 'planned', visitedOn: null }),
    ];
    const [september, october] = coachingByMonth(
      ['2026-09-01', '2026-10-01'],
      'crp-1',
      visits,
      new Map([
        [followed.id, { total: 9, feedbackAgreedAt: '2026-10-10T05:00:00Z' }],
        // Scored before the feedback was agreed again: it waits for its own score.
        [agreedAgain.id, { total: 4, feedbackAgreedAt: '2026-10-10T05:00:00.000Z' }],
      ]),
      [
        { createdAt: '2026-10-02T10:00:00.000Z', checks: 3 },
        { createdAt: '2026-10-05T10:00:00.000Z', checks: 4 },
        // Half past one in the morning of 1 October in India.
        { createdAt: '2026-09-30T20:00:00.000Z', checks: 5 },
      ],
    );
    expect(september).toMatchObject({
      visits: 1,
      followUps: 0,
      averageScore: 9,
      averageChecks: null,
    });
    expect(october).toMatchObject({
      visits: 3,
      followUps: 2,
      practised: 1,
      partly: 1,
      minutesToFeedback: 30,
      averageScore: null,
      averageChecks: 4,
    });
  });
});

describe("an office's report", () => {
  it('keeps withheld figures withheld, and reads the rest', () => {
    const report = toAreaReport({
      fewest_classes: 5,
      fewest_schools: 3,
      fewest_crps: 2,
      last_month: '2026-09-01',
      schools: 12,
      classes: 40,
      coaching: [
        {
          month: '2026-09-01',
          visits_done: { visits: 9, classes: 7 },
          follow_ups: null,
          feedback_score: { average: 8.5 },
          time_to_feedback: null,
        },
      ],
      pulse: [
        { month: '2026-09-01', grade: 1, language: 'hi', withheld: true },
        {
          month: '2026-09-01',
          grade: 2,
          language: 'en',
          withheld: false,
          classes: 6,
          checked: 60,
          needs_support: 20,
          hesitant: 25,
          fluent: 15,
          independent: 30,
          speed: { timed: 20, median_wcpm: 38, at_lakshya: 6, lakshya: 45 },
        },
        {
          month: '2026-09-01',
          grade: 3,
          language: 'hi',
          withheld: false,
          classes: 5,
          checked: 50,
          needs_support: 10,
          hesitant: 20,
          fluent: 20,
          independent: 40,
          speed: null,
        },
      ],
    });
    expect(report).toMatchObject({
      fewestClasses: 5,
      fewestSchools: 3,
      fewestCrps: 2,
      lastMonth: '2026-09-01',
    });
    expect(report?.coaching[0]).toEqual({
      month: '2026-09-01',
      visitsDone: { visits: 9, classes: 7 },
      followUps: null,
      feedbackScore: { average: 8.5 },
      timeToFeedback: null,
    });
    expect(report?.pulse[0]).toEqual({
      month: '2026-09-01',
      grade: 1,
      language: 'hi',
      withheld: true,
    });
    expect(report?.pulse[1]).toMatchObject({
      withheld: false,
      language: 'en',
      speed: { timed: 20, medianWcpm: 38, atLakshya: 6, lakshya: 45 },
    });
    expect(report?.pulse[2]).toMatchObject({ withheld: false, speed: null });
    // Anything not plainly shown counts as withheld.
    expect(toAreaReport({ pulse: [{ month: '2026-09-01', grade: 2 }] })?.pulse[0]).toMatchObject({
      withheld: true,
    });
    expect(toAreaReport(null)).toBeNull();
  });
});
