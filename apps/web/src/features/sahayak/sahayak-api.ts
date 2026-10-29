import { queryOptions } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { evidenceKey, feedbackFingerprint } from '@shared/feedback-fingerprint.ts';
import { redactNames, type NameToHide } from '@shared/redact.ts';
import { addDays } from '@/features/attendance/dates';
import { focusItem, momentTag, textIn, type LocalText } from '@/features/visits/observation-bank';
import { PRACTICES, practice } from '@/features/visits/practice-library';
import type { ClassSignal } from '@/features/visits/plan';
import type { Evidence, Visit, VisitFeedback } from '@/features/visits/visit-change';
import { callFunction, FunctionCallError } from '@/lib/functions';
import { getSupabase } from '@/lib/supabase';

/**
 * The application's side of Sahayak, the language-model help of the CRP workspace. Every request
 * goes through the `sahayak` Edge Function, needs a network, and is never queued: an answer an
 * hour later is of no use in a conversation. Names of children and of the teacher are replaced on
 * the phone before anything is sent.
 */

export type SahayakLanguage = 'hi' | 'en';

/** Why Sahayak could not answer, in words for the CRP. */
export function sahayakError(error: unknown, t: TFunction): string {
  const code = error instanceof FunctionCallError ? error.code : 'internal_error';
  switch (code) {
    case 'network':
      return t('sahayak.errors.network');
    case 'not_configured':
      return t('sahayak.errors.notConfigured');
    case 'quota_exceeded':
      return t('sahayak.errors.quota');
    case 'ai_unavailable':
      return t('sahayak.errors.unavailable');
    case 'ai_refused':
      return t('sahayak.errors.refused');
    case 'not_found':
      return t('sahayak.errors.notSaved');
    case 'forbidden':
      return t('sahayak.errors.forbidden');
    default:
      return t('sahayak.errors.other');
  }
}

// ---------------------------------------------------------------------------------------------
// Feedback draft
// ---------------------------------------------------------------------------------------------

export interface FeedbackDraft {
  strength: string;
  evidence: Evidence[];
  practiceCode: string;
  changeNote: string;
  technique: string;
  planNote: string;
  checkBackDays: number;
}

interface DraftAnswer {
  draft: {
    strength: string;
    evidence: Evidence[];
    practice_code: string;
    change_note: string | null;
    technique: string | null;
    plan_note: string | null;
    check_back_days: number;
  };
}

/** The names to take out: the class's children and the observed teacher. */
export function namesToHide(children: readonly string[], teacher: string | null): NameToHide[] {
  return [
    ...children.map((name) => ({ name, label: '[child]' })),
    ...(teacher ? [{ name: teacher, label: '[teacher]' }] : []),
  ];
}

/**
 * What the function is sent to draft feedback: what the CRP recorded, with the texts of the codes
 * in the feedback's language, the class's Pulse, the voice note, and the practice library.
 */
export function draftRequest(input: {
  visit: Visit;
  language: SahayakLanguage;
  grade: number | null;
  signal: Pick<
    ClassSignal,
    'pulseChecked' | 'needsSupport' | 'hesitant' | 'fluent' | 'englishNoResponse'
  > | null;
  earlier: { practiceCode: string | null; result: Visit['followUpResult'] } | null;
  transcript: string | null;
  names: readonly NameToHide[];
}) {
  const { visit, language, names } = input;
  const local = (text: LocalText) => textIn(text, language);
  // Labels are longer than some names, so a text is cut to its limit after names are replaced.
  const hide = (text: string | null | undefined, limit: number) =>
    text?.trim() ? Array.from(redactNames(text.trim(), names)).slice(0, limit).join('') : null;
  const earlierPractice = input.earlier?.practiceCode
    ? practice(input.earlier.practiceCode)
    : undefined;
  return {
    action: 'draft_feedback',
    language,
    visit: {
      class_section_id: visit.classSectionId,
      teacher_id: visit.teacherId,
      grade: input.grade,
      lesson: hide(visit.lessonNote, 160),
      focus: visit.observations.map((item) => {
        const known = focusItem(item.itemCode);
        return {
          code: item.itemCode,
          text: known ? local(known.text) : item.itemCode,
          answer: item.answer,
          note: hide(item.note, 300),
        };
      }),
      moments: visit.moments.map((moment) => {
        const tag = momentTag(moment.tagCode);
        return {
          id: moment.id,
          tag: tag ? local(tag.text) : moment.tagCode,
          tone: tag?.tone ?? 'concern',
          minute: Math.min(720, Math.floor(moment.atSeconds / 60)),
          note: hide(moment.note, 200),
        };
      }),
      pulse:
        input.signal && input.signal.pulseChecked > 0
          ? {
              checked: input.signal.pulseChecked,
              needs_support: input.signal.needsSupport,
              hesitant: input.signal.hesitant,
              fluent: input.signal.fluent,
              english_no_response: input.signal.englishNoResponse,
            }
          : null,
      follow_up: earlierPractice
        ? { practice: local(earlierPractice.title), result: input.earlier?.result ?? null }
        : null,
      transcript: hide(input.transcript, 8000),
      practices: PRACTICES.map((entry) => ({
        code: entry.code,
        title: local(entry.title),
        why: local(entry.why).slice(0, 400),
      })),
    },
  };
}

export async function draftFeedback(
  request: ReturnType<typeof draftRequest>,
): Promise<FeedbackDraft> {
  const answer = await callFunction<DraftAnswer>('sahayak', request);
  const draft = answer.draft;
  return {
    strength: draft.strength,
    evidence: draft.evidence,
    practiceCode: draft.practice_code,
    changeNote: draft.change_note ?? '',
    technique: draft.technique ?? '',
    planNote: draft.plan_note ?? '',
    checkBackDays: draft.check_back_days,
  };
}

/**
 * The evidence the coaching form lets the CRP choose for a strength: moments of strength, and
 * focus items seen in the lesson.
 */
export function isCitable(visit: Visit, entry: Evidence): boolean {
  if ('moment' in entry) {
    const moment = visit.moments.find((candidate) => candidate.id === entry.moment);
    return moment !== undefined && momentTag(moment.tagCode)?.tone === 'strength';
  }
  return visit.observations.some((item) => item.itemCode === entry.item && item.answer === 'yes');
}

/** The days after the visit to check back that a draft proposes, within what the database accepts. */
export function checkBackDaysOf(draft: FeedbackDraft, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, draft.checkBackDays));
}

/**
 * The feedback with the draft taken in. A part the draft leaves empty keeps what the CRP wrote;
 * the screen offers to undo the whole step. Only evidence the form can show is kept, and the
 * check-back date stays within the days the database accepts after the visit.
 */
export function withDraft(
  feedback: VisitFeedback,
  draft: FeedbackDraft,
  visit: Visit,
  visitedOn: string,
  range: { min: number; max: number },
): VisitFeedback {
  const days = checkBackDaysOf(draft, range);
  return {
    ...feedback,
    strength: draft.strength || feedback.strength,
    evidence: draft.evidence.filter((entry) => isCitable(visit, entry)).slice(0, 8),
    practiceCode: draft.practiceCode,
    changeNote: draft.changeNote || feedback.changeNote,
    technique: draft.technique || feedback.technique,
    planNote: draft.planNote || feedback.planNote,
    checkBackOn: addDays(visitedOn, days),
    // A draft changes what was agreed, so it has to be agreed again.
    agreedAt: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Feedback score
// ---------------------------------------------------------------------------------------------

export interface FeedbackScore {
  specific: number;
  evidence: number;
  oneFocus: number;
  demonstration: number;
  checkBack: number;
  respectful: number;
  total: number;
  tip: string;
  feedbackAgreedAt: string;
  feedbackFingerprint: string;
  scoredAt: string;
}

export const SCORE_PARTS = [
  'specific',
  'evidence',
  'oneFocus',
  'demonstration',
  'checkBack',
  'respectful',
] as const;

interface ScoreRow {
  specific: number;
  evidence: number;
  one_focus: number;
  demonstration: number;
  check_back: number;
  respectful: number;
  total: number | null;
  tip: string;
  feedback_agreed_at: string;
  feedback_fingerprint: string;
  scored_at: string;
}

function toScore(row: ScoreRow): FeedbackScore {
  return {
    specific: row.specific,
    evidence: row.evidence,
    oneFocus: row.one_focus,
    demonstration: row.demonstration,
    checkBack: row.check_back,
    respectful: row.respectful,
    total:
      row.total ??
      row.specific +
        row.evidence +
        row.one_focus +
        row.demonstration +
        row.check_back +
        row.respectful,
    tip: row.tip,
    feedbackAgreedAt: row.feedback_agreed_at,
    feedbackFingerprint: row.feedback_fingerprint,
    scoredAt: row.scored_at,
  };
}

export const feedbackScoreKey = (visitId: string) => ['feedback-score', visitId] as const;

/** The private score of the visit's feedback, when it has been scored. */
export function feedbackScoreQuery(visitId: string) {
  return queryOptions({
    queryKey: feedbackScoreKey(visitId),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FeedbackScore | null> => {
      const { data, error } = await getSupabase()
        .from('visit_feedback_scores')
        .select(
          'specific, evidence, one_focus, demonstration, check_back, respectful, total, tip, feedback_agreed_at, feedback_fingerprint, scored_at',
        )
        .eq('visit_id', visitId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data ? toScore(data) : null;
    },
  });
}

export async function scoreFeedback(visitId: string, language: SahayakLanguage) {
  const answer = await callFunction<{ score: ScoreRow }>('sahayak', {
    action: 'score_feedback',
    language,
    visit_id: visitId,
  });
  return toScore(answer.score);
}

/** The fingerprint of feedback as the phone holds it, computed as the function computes it. */
export function fingerprintOf(feedback: VisitFeedback): Promise<string> {
  return feedbackFingerprint({
    strength: feedback.strength,
    evidence: feedback.evidence.map(evidenceKey),
    practiceCode: feedback.practiceCode,
    changeNote: feedback.changeNote,
    technique: feedback.technique,
    demoGiven: feedback.demoGiven,
    planNote: feedback.planNote,
    checkBackOn: feedback.checkBackOn,
  });
}

/** Whether a score is of the feedback as it stands now. */
export function scoreIsCurrent(score: FeedbackScore, fingerprint: string | null): boolean {
  return fingerprint !== null && score.feedbackFingerprint === fingerprint;
}

// ---------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------

export interface OrderTask {
  title: string;
  details: string | null;
  dueOn: string | null;
}

export interface ReadOrder {
  readable: boolean;
  issuer: string | null;
  orderDate: string | null;
  tasks: OrderTask[];
}

export async function readOrder(
  picture: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
  language: SahayakLanguage,
): Promise<ReadOrder> {
  const answer = await callFunction<{
    readable: boolean;
    issuer: string | null;
    order_date: string | null;
    tasks: { title: string; details: string | null; due_on: string | null }[];
  }>('sahayak', {
    action: 'read_order',
    language,
    media_type: picture.mediaType,
    image: picture.base64,
  });
  return {
    readable: answer.readable,
    issuer: answer.issuer,
    orderDate: answer.order_date,
    tasks: answer.tasks.map((task) => ({
      title: task.title,
      details: task.details,
      dueOn: task.due_on,
    })),
  };
}

/** A picture as base64, without the data URL's prefix. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------------------------
// Rehearsal room
// ---------------------------------------------------------------------------------------------

/** The simulated teachers, as the application's messages name them. */
export const SCENARIO_CODES = [
  'tired-veteran',
  'eager-new-teacher',
  'pulse-defensive',
  'overloaded-head-teacher',
] as const;
export type ScenarioCode = (typeof SCENARIO_CODES)[number];

export function scenarioCodeOf(code: string): ScenarioCode | null {
  return SCENARIO_CODES.find((entry) => entry === code) ?? null;
}

export interface RehearsalLine {
  role: 'crp' | 'teacher';
  text: string;
}

export async function rehearse(
  scenario: string,
  language: SahayakLanguage,
  messages: readonly RehearsalLine[],
): Promise<{ reply: string; provider: 'claude' | 'groq' }> {
  return callFunction('sahayak', { action: 'rehearse', language, scenario, messages });
}

export interface Debrief {
  id: string;
  scenario: string;
  turns: number;
  namedPractice: boolean;
  askedConstraints: boolean;
  agreedCheckBack: boolean;
  keptBlameOut: boolean;
  citedEvidence: boolean;
  wentWell: string;
  tryNext: string;
  createdAt: string;
}

export const DEBRIEF_CHECKS = [
  'namedPractice',
  'askedConstraints',
  'agreedCheckBack',
  'keptBlameOut',
  'citedEvidence',
] as const;

interface DebriefRow {
  id: string;
  scenario: string;
  turns: number;
  named_practice: boolean;
  asked_constraints: boolean;
  agreed_check_back: boolean;
  kept_blame_out: boolean;
  cited_evidence: boolean;
  went_well: string;
  try_next: string;
  created_at: string;
}

function toDebrief(row: DebriefRow): Debrief {
  return {
    id: row.id,
    scenario: row.scenario,
    turns: row.turns,
    namedPractice: row.named_practice,
    askedConstraints: row.asked_constraints,
    agreedCheckBack: row.agreed_check_back,
    keptBlameOut: row.kept_blame_out,
    citedEvidence: row.cited_evidence,
    wentWell: row.went_well,
    tryNext: row.try_next,
    createdAt: row.created_at,
  };
}

export async function debrief(
  scenario: string,
  language: SahayakLanguage,
  messages: readonly RehearsalLine[],
): Promise<Debrief> {
  const answer = await callFunction<{ debrief: DebriefRow }>('sahayak', {
    action: 'debrief',
    language,
    scenario,
    messages,
  });
  return toDebrief(answer.debrief);
}

export const debriefsKey = () => ['rehearsal-debriefs'] as const;

/** The CRP's latest debriefs, the newest first. */
export function debriefsQuery() {
  return queryOptions({
    queryKey: debriefsKey(),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Debrief[]> => {
      const { data, error } = await getSupabase()
        .from('rehearsal_debriefs')
        .select(
          'id, scenario, turns, named_practice, asked_constraints, agreed_check_back, kept_blame_out, cited_evidence, went_well, try_next, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) {
        throw error;
      }
      return data.map(toDebrief);
    },
  });
}

/** How many of the five checks a debrief met. */
export function checksMet(entry: Debrief): number {
  return DEBRIEF_CHECKS.filter((check) => entry[check]).length;
}
