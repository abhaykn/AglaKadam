import { FOCUS_ITEMS_PER_VISIT, focusItem } from './observation-bank';
import { practice, PRACTICES, type Practice } from './practice-library';
import { daysBetween, type ClassSignal } from './plan';

/**
 * Rules that prepare and review a visit: the focus items to look at, the practices likely to be
 * agreed, the children to hear again, and simple checks of the feedback before it is given. All of
 * them are plain rules on what the phone holds, so they work without a network and can be
 * explained.
 */

/** A share of children at or above which a gap counts as large. */
export const LARGE_GAP = 0.3;

/**
 * The focus items for a visit to a class: the item of the step being followed up first, then items
 * for the class's largest gaps, then the core items of a reading lesson.
 */
export function suggestFocusItems(
  signal: Pick<ClassSignal, 'pulseChecked' | 'needsSupport' | 'englishNoResponse'> | null,
  followUpPracticeCode: string | null = null,
): string[] {
  const chosen: string[] = [];
  const add = (code: string | undefined) => {
    if (code && focusItem(code) && !chosen.includes(code)) {
      chosen.push(code);
    }
  };
  add(followUpPracticeCode ? practice(followUpPracticeCode)?.checkItem : undefined);
  if (signal && signal.pulseChecked > 0) {
    if (signal.needsSupport / signal.pulseChecked >= LARGE_GAP) {
      add('sounds-before-letters');
      add('bottom-group-turns');
    }
    if (signal.englishNoResponse / signal.pulseChecked >= LARGE_GAP) {
      add('english-own-sentences');
    }
  }
  for (const code of [
    'every-child-reads',
    'todays-textbook-page',
    'reads-for-meaning',
    'children-talk-more',
    'checks-understanding',
  ]) {
    add(code);
  }
  return chosen.slice(0, FOCUS_ITEMS_PER_VISIT);
}

export interface ObservedItem {
  itemCode: string;
  answer: 'yes' | 'no' | 'not_seen' | null;
}

/**
 * The practices most likely to help, from what was observed: those of the items seen not to happen
 * first, in the order of the items, then those of the other items. Before the visit, when nothing
 * is answered yet, the practices of the focus items in order.
 */
export function suggestPractices(observed: readonly ObservedItem[], count = 2): Practice[] {
  const ordered = [
    ...observed.filter((item) => item.answer === 'no'),
    ...observed.filter((item) => item.answer !== 'no'),
  ];
  const codes: string[] = [];
  for (const item of ordered) {
    for (const code of focusItem(item.itemCode)?.practices ?? []) {
      if (!codes.includes(code)) {
        codes.push(code);
      }
    }
  }
  return codes
    .map((code) => PRACTICES.find((entry) => entry.code === code))
    .filter((entry): entry is Practice => entry !== undefined)
    .slice(0, count);
}

export interface FeedbackDraft {
  strength: string;
  evidenceCount: number;
  practiceCode: string | null;
  changeNote: string;
  technique: string;
  demoGiven: boolean;
  checkBackOn: string | null;
}

export type TipKey = 'evidence' | 'specific' | 'oneStep' | 'demo' | 'soon';

export interface Tip {
  key: TipKey;
  met: boolean;
}

/** Feedback within this many days keeps the step alive. */
export const CHECK_BACK_SOON_DAYS = 21;
/** A technique described in fewer characters rarely says what to do. */
const SPECIFIC_LENGTH = 30;

/**
 * What makes feedback actionable, checked on the draft: a strength resting on evidence, one step
 * described exactly, a demonstration, and a check-back within three weeks. Shown to the CRP only,
 * as suggestions, never as a grade.
 */
export function feedbackTips(draft: FeedbackDraft, visitedOn: string): Tip[] {
  const exact = Math.max(draft.technique.trim().length, draft.changeNote.trim().length);
  return [
    { key: 'evidence', met: draft.strength.trim().length > 0 && draft.evidenceCount > 0 },
    { key: 'oneStep', met: draft.practiceCode !== null },
    { key: 'specific', met: exact >= SPECIFIC_LENGTH },
    { key: 'demo', met: draft.demoGiven },
    {
      key: 'soon',
      met:
        draft.checkBackOn !== null &&
        daysBetween(visitedOn, draft.checkBackOn) <= CHECK_BACK_SOON_DAYS,
    },
  ];
}

export type ReadingLevel = 'fluent' | 'hesitant' | 'needs_support';
export type EnglishLevel = 'sentences' | 'words' | 'no_response';

const READING_ORDER: Record<ReadingLevel, number> = { needs_support: 0, hesitant: 1, fluent: 2 };

export interface RecheckCandidate {
  checkId: string;
  studentId: string;
  teacherReading: ReadingLevel;
  machineReading: ReadingLevel | null;
  reviewed: boolean;
}

/** A stable number from a string, to break ties the same way on every device. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The children of the class's last Pulse to hear again during a visit, two at most: first those
 * the teacher rated higher than the engine heard, then any other disagreement, then children the
 * teacher rated fluent; among equals, an order fixed by the visit, so that the choice cannot be
 * steered.
 */
export function chooseRechecks(
  candidates: readonly RecheckCandidate[],
  visitId: string,
  count = 2,
): RecheckCandidate[] {
  const priority = (candidate: RecheckCandidate): number => {
    if (candidate.reviewed) {
      return 4;
    }
    if (candidate.machineReading !== null) {
      const gap = READING_ORDER[candidate.teacherReading] - READING_ORDER[candidate.machineReading];
      if (gap > 0) {
        return 0;
      }
      if (gap < 0) {
        return 1;
      }
    }
    return candidate.teacherReading === 'fluent' ? 2 : 3;
  };
  return [...candidates]
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        hashOf(`${visitId}:${a.checkId}`) - hashOf(`${visitId}:${b.checkId}`),
    )
    .slice(0, count);
}

/** Whether a re-check in person differs enough from the check to talk about it. */
export function recheckGapIsLarge(checked: ReadingLevel, heard: ReadingLevel): boolean {
  return Math.abs(READING_ORDER[checked] - READING_ORDER[heard]) >= 2;
}

export interface LevelPair {
  teacher: ReadingLevel;
  crp: ReadingLevel;
}

/** Comparisons needed before a pattern is worth a conversation. */
export const CALIBRATION_MIN = 4;
/** Below this share of agreement the CRP is prompted to talk with the teacher. */
export const CALIBRATION_AGREEMENT = 0.6;

/**
 * How often a teacher's reading levels match the CRP's own, from the recordings the CRP reviewed
 * and the children re-checked in person. A low agreement is a reason for a friendly conversation
 * about how levels are judged, not a judgement of the teacher.
 */
export function calibration(pairs: readonly LevelPair[]): {
  compared: number;
  agreed: number;
  prompt: boolean;
} {
  const agreed = pairs.filter((pair) => pair.teacher === pair.crp).length;
  return {
    compared: pairs.length,
    agreed,
    prompt: pairs.length >= CALIBRATION_MIN && agreed / pairs.length < CALIBRATION_AGREEMENT,
  };
}
