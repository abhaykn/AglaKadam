import type { OutboxError, OutboxState } from '@/features/offline/device-store';
import type {
  PulseAbsenceChange,
  PulseCheckChange,
  PulseChild,
  PulseCycleView,
} from './pulse-change';

/**
 * Where each drawn child stands, from what the server has recorded and what still waits on this
 * device. Kept apart from the screens so that the rules can be tested on their own.
 */

export interface WaitingCheck {
  outboxId: string;
  change: PulseCheckChange;
  state: OutboxState;
  error: OutboxError | null;
}

export interface WaitingAbsence {
  change: PulseAbsenceChange;
  state: OutboxState;
}

export interface FirstAttempt {
  mode: 'recorded' | 'adapted';
  itemCode: string | null;
  promptCode: string | null;
  classroom: 'normal' | 'noisy' | null;
  /** Recorded on the server, waiting on this device, or refused by the server. */
  where: 'server' | 'device' | 'refused';
  waiting: WaitingCheck | null;
}

export type ChildStatus =
  | { kind: 'due'; late: boolean; absentToday: boolean }
  | {
      kind: 'recorded';
      first: FirstAttempt;
      secondRecorded: boolean;
      /** The second recording, while it waits on this device. */
      secondWaiting: WaitingCheck | null;
      canRetake: boolean;
    }
  | { kind: 'replaced'; reason: 'absent' | 'left' | 'consent' };

/** The order in which children are listed: the earliest due first, then by name. */
export function compareDue(a: PulseChild, b: PulseChild): number {
  return a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name, 'hi');
}

export function statusOf(
  child: PulseChild,
  today: string,
  waitingChecks: readonly WaitingCheck[],
  waitingAbsences: readonly WaitingAbsence[],
): ChildStatus {
  const waitingOfChild = waitingChecks.filter((entry) => entry.change.sampleId === child.sampleId);
  const serverFirst = child.checks.find((check) => check.attempt === 1);
  const attemptOf = (entry: WaitingCheck) =>
    entry.change.mode === 'recorded' ? entry.change.attempt : 1;
  const waitingFirst = waitingOfChild.find((entry) => attemptOf(entry) === 1) ?? null;

  let first: FirstAttempt | null = null;
  if (serverFirst) {
    first = {
      mode: serverFirst.mode,
      itemCode: serverFirst.itemCode,
      promptCode: serverFirst.promptCode,
      classroom: serverFirst.classroom,
      where: 'server',
      waiting: null,
    };
  } else if (waitingFirst) {
    const change = waitingFirst.change;
    first = {
      mode: change.mode,
      itemCode: change.mode === 'recorded' ? change.itemCode : null,
      promptCode: change.mode === 'recorded' ? change.promptCode : null,
      classroom: change.mode === 'recorded' ? change.classroom : null,
      where: waitingFirst.state === 'failed' ? 'refused' : 'device',
      waiting: waitingFirst,
    };
  }

  if (!first) {
    if (child.replacedAt !== null) {
      return { kind: 'replaced', reason: child.replacementReason ?? 'absent' };
    }
    // An absence the server refused does not count: the child can still be marked or recorded.
    const absentToday =
      child.absences.includes(today) ||
      waitingAbsences.some(
        (entry) =>
          entry.change.sampleId === child.sampleId &&
          entry.change.date === today &&
          entry.state !== 'failed',
      );
    return { kind: 'due', late: today > child.dueOn, absentToday };
  }

  const secondWaiting = waitingOfChild.find((entry) => attemptOf(entry) === 2) ?? null;
  // A second recording the server refused is shown with its reason, not as recorded; another is
  // offered only once the person has removed it from the phone.
  const secondRecorded =
    child.checks.some((check) => check.attempt === 2) ||
    (secondWaiting !== null && secondWaiting.state !== 'failed');
  return {
    kind: 'recorded',
    first,
    secondRecorded,
    secondWaiting,
    // One more recording, with new items, only after a noisy classroom, and only once the server
    // has the first: the database takes a second recording only after the first, so one made while
    // the first waits on the device could never be sent if the first were refused.
    canRetake:
      first.mode === 'recorded' &&
      first.classroom === 'noisy' &&
      !secondRecorded &&
      secondWaiting === null &&
      first.where === 'server',
  };
}

export interface PulseProgress {
  /** Children recorded this month, on the server or waiting on the device (not refused). */
  recorded: number;
  /** Children the month's draw asked for. */
  target: number;
  /** Drawn children whose week has not opened yet. */
  hidden: number;
  due: PulseChild[];
  recordedChildren: PulseChild[];
  replaced: PulseChild[];
}

export function progressOf(
  view: PulseCycleView,
  today: string,
  waitingChecks: readonly WaitingCheck[],
  waitingAbsences: readonly WaitingAbsence[],
): PulseProgress {
  const due: PulseChild[] = [];
  const recordedChildren: PulseChild[] = [];
  const replaced: PulseChild[] = [];
  // A check the server refused is listed with its reason, but does not count as recorded.
  let recorded = 0;
  for (const child of view.children) {
    const status = statusOf(child, today, waitingChecks, waitingAbsences);
    if (status.kind === 'due') {
      due.push(child);
    } else if (status.kind === 'recorded') {
      recordedChildren.push(child);
      if (status.first.where !== 'refused') {
        recorded += 1;
      }
    } else {
      replaced.push(child);
    }
  }
  // Late children first, then by the day they are due.
  due.sort(compareDue);
  const target = view.cycle?.sampleSize ?? 0;
  const drawnShown = view.children.filter((child) => child.replacesSampleId === null).length;
  return {
    recorded,
    target,
    hidden: Math.max(0, target - drawnShown),
    due,
    recordedChildren,
    replaced,
  };
}
