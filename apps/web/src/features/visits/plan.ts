/**
 * The week's plan: which classes a CRP should visit first, and why.
 *
 * The ranking is plain arithmetic on the cluster's records, so that a CRP can always see why a class
 * comes first and can reorder the plan with good reason. It runs on the phone from the records kept
 * there, and so works without a network. The weights favour, in this order: an agreed step whose
 * check-back is due, a large share of children needing support in the last Pulse, a teacher who
 * asked for a visit, and a class that has gone long without one. A class visited in the last few
 * days without a check-back due drops back, so that visits spread across the cluster.
 */

export interface ClassSignal {
  classSectionId: string;
  schoolId: string;
  grade: number;
  section: string;
  medium: string;
  pulseMonth: string | null;
  pulseChecked: number;
  needsSupport: number;
  hesitant: number;
  fluent: number;
  englishNoResponse: number;
  toListen: number;
  lastVisitOn: string | null;
  visitsThisYear: number;
  checkBackOn: string | null;
  checkBackVisitId: string | null;
  requestTopic: string | null;
  requestedAt: string | null;
  /** Recent language papers whose marks Pulse does not bear out. */
  marksToDiscuss: number;
}

export interface PlanTask {
  schoolId: string | null;
  dueOn: string | null;
  done: boolean;
}

export type Reason =
  | { kind: 'checkBack'; on: string; overdue: boolean }
  | { kind: 'readingGap'; needsSupport: number; checked: number }
  | { kind: 'englishGap'; noResponse: number; checked: number }
  | { kind: 'request'; topic: string }
  | { kind: 'notVisited'; days: number | null }
  | { kind: 'taskDue'; count: number }
  | { kind: 'marksCheck'; count: number }
  | { kind: 'visitedRecently'; days: number };

export type Band = 'high' | 'medium' | 'low';

export interface RankedClass {
  signal: ClassSignal;
  score: number;
  band: Band;
  /** The reasons for the score, largest first. */
  reasons: Reason[];
}

/** Points for each reason. Changing them changes every CRP's plan, so they are kept together. */
export const WEIGHTS = {
  checkBackDue: 30,
  checkBackOverdue: 35,
  /** Multiplied by the share of children checked who need support. */
  readingGap: 40,
  /** Multiplied by the share of children checked who did not answer in English. */
  englishGap: 15,
  request: 20,
  /** For a class not visited at all this academic year. */
  neverVisited: 25,
  /** One point for every two days since the last visit, up to `neverVisited`. */
  daysPerPoint: 2,
  taskDue: 10,
  /** Recent marks that Pulse does not bear out: worth a conversation during a visit. */
  marksCheck: 15,
  visitedRecently: -20,
} as const;

/** Fewer children checked than this say too little about a class to rank it by. */
export const MIN_CHECKED = 3;
/** A visit within this many days counts as recent. */
export const RECENT_DAYS = 7;

const DAY = 86_400_000;

/** Whole days from one ISO date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/**
 * The working week a plan is for, Monday to Saturday. On a Sunday it is the coming week, which is
 * when a CRP prepares it.
 */
export function planWeek(today: string): { start: string; end: string; days: string[] } {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = weekday === 0 ? addDays(today, 1) : addDays(today, 1 - weekday);
  const days = Array.from({ length: 6 }, (_, index) => addDays(start, index));
  return { start, end: days[5] ?? start, days };
}

/**
 * The days the plan lists: the days of the week, then each later day something is planned on.
 * Visits can be planned up to two weeks ahead, and every planned visit must stay in sight so that
 * it can be taken off the plan.
 */
export function plannedDays(
  week: { end: string; days: readonly string[] },
  plannedOn: readonly string[],
): string[] {
  return [...week.days, ...new Set(plannedOn.filter((day) => day > week.end).sort())];
}

/** The next working days from today (Monday to Saturday), today included when it is one. */
export function workingDaysFrom(today: string, count: number): string[] {
  const days: string[] = [];
  for (let offset = 0; days.length < count && offset < count * 2; offset += 1) {
    const day = addDays(today, offset);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 0) {
      days.push(day);
    }
  }
  return days;
}

export function bandOf(score: number): Band {
  if (score >= 60) {
    return 'high';
  }
  return score >= 35 ? 'medium' : 'low';
}

const reasonOrder: Record<Reason['kind'], number> = {
  checkBack: 0,
  readingGap: 1,
  request: 2,
  notVisited: 3,
  englishGap: 4,
  taskDue: 5,
  marksCheck: 6,
  visitedRecently: 7,
};

export function rankClass(
  signal: ClassSignal,
  tasks: readonly PlanTask[],
  today: string,
): RankedClass {
  const week = planWeek(today);
  const reasons: Reason[] = [];
  let score = 0;

  const checkBackDue = signal.checkBackOn !== null && signal.checkBackOn <= week.end;
  if (signal.checkBackOn !== null && checkBackDue) {
    const overdue = signal.checkBackOn < today;
    score += overdue ? WEIGHTS.checkBackOverdue : WEIGHTS.checkBackDue;
    reasons.push({ kind: 'checkBack', on: signal.checkBackOn, overdue });
  }

  if (signal.pulseChecked >= MIN_CHECKED) {
    const readingShare = signal.needsSupport / signal.pulseChecked;
    if (signal.needsSupport > 0) {
      score += Math.round(WEIGHTS.readingGap * readingShare);
      reasons.push({
        kind: 'readingGap',
        needsSupport: signal.needsSupport,
        checked: signal.pulseChecked,
      });
    }
    if (signal.englishNoResponse > 0) {
      score += Math.round((WEIGHTS.englishGap * signal.englishNoResponse) / signal.pulseChecked);
      reasons.push({
        kind: 'englishGap',
        noResponse: signal.englishNoResponse,
        checked: signal.pulseChecked,
      });
    }
  }

  if (signal.requestTopic !== null) {
    score += WEIGHTS.request;
    reasons.push({ kind: 'request', topic: signal.requestTopic });
  }

  if (signal.lastVisitOn === null) {
    score += WEIGHTS.neverVisited;
    reasons.push({ kind: 'notVisited', days: null });
  } else {
    const days = daysBetween(signal.lastVisitOn, today);
    if (days < RECENT_DAYS && !checkBackDue) {
      score += WEIGHTS.visitedRecently;
      reasons.push({ kind: 'visitedRecently', days });
    } else {
      const points = Math.min(WEIGHTS.neverVisited, Math.floor(days / WEIGHTS.daysPerPoint));
      if (points > 0) {
        score += points;
        reasons.push({ kind: 'notVisited', days });
      }
    }
  }

  if (signal.marksToDiscuss > 0) {
    score += WEIGHTS.marksCheck;
    reasons.push({ kind: 'marksCheck', count: signal.marksToDiscuss });
  }

  const due = tasks.filter(
    (task) =>
      !task.done &&
      task.schoolId === signal.schoolId &&
      task.dueOn !== null &&
      task.dueOn <= week.end,
  ).length;
  if (due > 0) {
    score += WEIGHTS.taskDue;
    reasons.push({ kind: 'taskDue', count: due });
  }

  const clamped = Math.max(0, Math.min(100, score));
  reasons.sort((a, b) => reasonOrder[a.kind] - reasonOrder[b.kind]);
  return { signal, score: clamped, band: bandOf(clamped), reasons };
}

/** Every class of the cluster, highest score first. */
export function rankClasses(
  signals: readonly ClassSignal[],
  tasks: readonly PlanTask[],
  today: string,
): RankedClass[] {
  return signals
    .map((signal) => rankClass(signal, tasks, today))
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Of equal scores, the class waiting longest for a visit comes first.
        (a.signal.lastVisitOn ?? '').localeCompare(b.signal.lastVisitOn ?? '') ||
        a.signal.schoolId.localeCompare(b.signal.schoolId) ||
        a.signal.grade - b.signal.grade ||
        a.signal.section.localeCompare(b.signal.section),
    );
}

export interface SchoolPlan {
  schoolId: string;
  /** The best score among the school's classes. */
  score: number;
  classes: RankedClass[];
}

/**
 * The ranked classes grouped by school, schools by their best class: a CRP usually sees two or
 * three classes on one trip to a school.
 */
export function bySchool(ranked: readonly RankedClass[]): SchoolPlan[] {
  const schools = new Map<string, SchoolPlan>();
  for (const entry of ranked) {
    const school = schools.get(entry.signal.schoolId);
    if (school) {
      school.classes.push(entry);
    } else {
      schools.set(entry.signal.schoolId, {
        schoolId: entry.signal.schoolId,
        score: entry.score,
        classes: [entry],
      });
    }
  }
  return [...schools.values()].sort((a, b) => b.score - a.score);
}
