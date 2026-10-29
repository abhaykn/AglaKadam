/**
 * Progress over months, worked out on the phone from what the database returns: reading levels in
 * order, how a child moved, and the CRP's own coaching month by month.
 */

import { dayInIndia } from '@/features/attendance/dates';

export type ReadingLevel = 'needs_support' | 'hesitant' | 'fluent';

export const READING_LEVELS: readonly ReadingLevel[] = ['needs_support', 'hesitant', 'fluent'];

/** NIPUN Bharat's Lakshya for reading speed: words read correctly per minute, by class. */
export const LAKSHYA: Partial<Record<number, number>> = { 2: 45, 3: 60 };

export function readingLevelOf(value: unknown): ReadingLevel | null {
  return READING_LEVELS.find((level) => level === value) ?? null;
}

/**
 * A month (`YYYY-MM-01`) for people to read: "Oct" or "अक्टू॰", or with the whole year, "Oct 2026".
 * A two-digit year would read as a day ("Sept 26").
 */
export function monthLabel(month: string, language: string, withYear = false): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}

/**
 * Labels for a run of months under a chart: the short month alone, or with the year marked by an
 * apostrophe ("Dec ’26") when the months reach into more than one year, short enough for a column.
 */
export function monthLabels(months: readonly string[], language: string): string[] {
  const years = new Set(months.map((month) => month.slice(0, 4)));
  return months.map((month) =>
    years.size > 1
      ? `${monthLabel(month, language)} ’${month.slice(2, 4)}`
      : monthLabel(month, language),
  );
}

export type Movement = 'up' | 'down' | 'same' | 'first';

/** How a child's reading level changed from the check before. */
export function movementOf(
  previous: ReadingLevel | null,
  latest: ReadingLevel | null,
): Movement | null {
  if (latest === null) {
    return null;
  }
  if (previous === null) {
    return 'first';
  }
  const change = READING_LEVELS.indexOf(latest) - READING_LEVELS.indexOf(previous);
  return change > 0 ? 'up' : change < 0 ? 'down' : 'same';
}

/** A share in whole percent; null without anything counted. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

/** The middle value; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Every month from the first of `months` to the last, as `YYYY-MM-01`, so that a month without
 * figures keeps its place on a chart instead of bringing its neighbours together.
 */
export function monthsSpanning(months: readonly string[]): string[] {
  const sorted = months.map((month) => `${month.slice(0, 7)}-01`).sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    return [];
  }
  const count =
    (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
    Number(last.slice(5, 7)) -
    Number(first.slice(5, 7)) +
    1;
  return lastMonths(last, count);
}

/** The last `count` months, oldest first, as `YYYY-MM-01`, ending with the month of `last`. */
export function lastMonths(last: string, count: number): string[] {
  const year = Number(last.slice(0, 4));
  const month = Number(last.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - (count - 1 - index), 1));
    return date.toISOString().slice(0, 10);
  });
}

// ---------------------------------------------------------------------------------------------
// The CRP's own coaching
// ---------------------------------------------------------------------------------------------

export interface CoachedVisit {
  id: string;
  crpId: string | null;
  status: 'planned' | 'done';
  visitedOn: string | null;
  startedAt: string | null;
  followsVisitId: string | null;
  followUpResult: 'practised' | 'partly' | 'not_yet' | null;
  moments: readonly { atSeconds: number }[];
  feedback: { agreedAt: string | null } | null;
}

export interface CoachingMonth {
  month: string;
  visits: number;
  followUps: number;
  practised: number;
  partly: number;
  /** Middle minutes from the last moment noted to the agreed feedback. */
  minutesToFeedback: number | null;
  /** Average of the feedback scores of the month's visits, out of 12. */
  averageScore: number | null;
  /** Average checks met in the month's rehearsals, out of 5. */
  averageChecks: number | null;
}

/**
 * Minutes from the end of the observed lesson (its last moment) to the agreed feedback; unknown
 * for a visit without moments, whose lesson end is not known.
 */
export function minutesToFeedback(visit: CoachedVisit): number | null {
  if (!visit.startedAt || !visit.feedback?.agreedAt || visit.moments.length === 0) {
    return null;
  }
  const lastMoment = Math.max(...visit.moments.map((moment) => moment.atSeconds));
  const lessonEnd = Date.parse(visit.startedAt) + lastMoment * 1000;
  return Math.max(0, Math.round((Date.parse(visit.feedback.agreedAt) - lessonEnd) / 60_000));
}

/** A feedback score's total, and when the feedback it scored was agreed. */
export interface FeedbackScore {
  total: number;
  feedbackAgreedAt: string;
}

/**
 * The CRP's visits, scores and rehearsals, month by month. A score counts only while the feedback
 * stands as it was scored; feedback agreed again afterwards waits for its own score.
 */
export function coachingByMonth(
  months: readonly string[],
  crpId: string,
  visits: readonly CoachedVisit[],
  scores: ReadonlyMap<string, FeedbackScore>,
  rehearsals: readonly { createdAt: string; checks: number }[],
): CoachingMonth[] {
  return months.map((month) => {
    const key = month.slice(0, 7);
    const own = visits.filter(
      (visit) =>
        visit.crpId === crpId && visit.status === 'done' && visit.visitedOn?.slice(0, 7) === key,
    );
    const followUps = own.filter(
      (visit) => visit.followsVisitId !== null && visit.followUpResult !== null,
    );
    const minutes = own.flatMap((visit) => {
      const value = minutesToFeedback(visit);
      return value === null ? [] : [value];
    });
    const scored = own.flatMap((visit) => {
      const score = scores.get(visit.id);
      const agreedAt = visit.feedback?.agreedAt;
      return score && agreedAt && Date.parse(score.feedbackAgreedAt) === Date.parse(agreedAt)
        ? [score.total]
        : [];
    });
    const practice = rehearsals.filter((entry) => dayInIndia(entry.createdAt).slice(0, 7) === key);
    const average = (values: readonly number[]) =>
      values.length > 0
        ? Math.round((values.reduce((sum, value) => sum + value, 0) * 10) / values.length) / 10
        : null;
    return {
      month,
      visits: own.length,
      followUps: followUps.length,
      practised: followUps.filter((visit) => visit.followUpResult === 'practised').length,
      partly: followUps.filter((visit) => visit.followUpResult === 'partly').length,
      minutesToFeedback: median(minutes),
      averageScore: average(scored),
      averageChecks: average(practice.map((entry) => entry.checks)),
    };
  });
}
