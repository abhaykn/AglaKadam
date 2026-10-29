import { suggestFocusItems } from './coaching';
import type { ClassSignal } from './plan';
import type { Visit } from './visit-change';

/** The longest a visit lasts, as the database allows. */
export const VISIT_HOURS = 12;

/**
 * When a visit ended: now, but never before it started nor more than {@link VISIT_HOURS} after, so
 * that a visit finished the next day is still accepted.
 */
export function finishTime(startedAt: string | null, now: number = Date.now()): string {
  if (!startedAt) {
    return new Date(now).toISOString();
  }
  const started = Date.parse(startedAt);
  return new Date(
    Math.max(started, Math.min(now, started + VISIT_HOURS * 3_600_000)),
  ).toISOString();
}

/** A new visit to the class, with its focus items, the step it follows up and the request it answers. */
export function newVisit(options: {
  classSectionId: string;
  schoolId: string;
  crpId: string;
  signal: ClassSignal | undefined;
  followsVisit: Visit | undefined;
  requestId: string | null;
  plannedOn: string | null;
  today: string;
}): Visit {
  const items = suggestFocusItems(
    options.signal ?? null,
    options.followsVisit?.feedback?.practiceCode ?? null,
  );
  const planned = options.plannedOn !== null;
  return {
    id: crypto.randomUUID(),
    classSectionId: options.classSectionId,
    schoolId: options.schoolId,
    crpId: options.crpId,
    teacherId: null,
    status: planned ? 'planned' : 'done',
    plannedOn: options.plannedOn,
    visitedOn: planned ? null : options.today,
    startedAt: planned ? null : new Date().toISOString(),
    finishedAt: null,
    lessonNote: '',
    followsVisitId: options.followsVisit?.id ?? null,
    followUpResult: null,
    requestId: options.requestId,
    observations: items.map((itemCode, index) => ({
      itemCode,
      position: index + 1,
      answer: null,
      note: '',
    })),
    moments: [],
    rechecks: [],
    feedback: null,
  };
}

/** The latest visit of the class whose agreed step no later visit has followed up. */
export function stepToFollowUp(
  visits: readonly Visit[],
  classSectionId: string,
): Visit | undefined {
  const ofClass = visits
    .filter((visit) => visit.classSectionId === classSectionId && visit.status === 'done')
    .sort((a, b) => (b.visitedOn ?? '').localeCompare(a.visitedOn ?? ''));
  const agreed = ofClass.find((visit) => visit.feedback?.agreedAt);
  if (!agreed) {
    return undefined;
  }
  const followed = ofClass.some((visit) => visit.followsVisitId === agreed.id);
  return followed ? undefined : agreed;
}
