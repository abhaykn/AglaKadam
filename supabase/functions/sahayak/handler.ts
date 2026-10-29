/**
 * Sahayak, the language-model help of the CRP workspace. One function with five actions:
 *
 *   draft_feedback  a draft of the coaching feedback from the visit's record, which the phone sends
 *                   with names already replaced; the CRP edits it before anything is agreed;
 *   score_feedback  the private rubric score of feedback the CRP agreed, read from the database;
 *   read_order      the tasks in a photo of an order from the block, for the CRP to check;
 *   rehearse        the next line of the simulated teacher in the rehearsal room;
 *   debrief         the review of a finished rehearsal, kept for the CRP.
 *
 * Each action takes one request from the CRP's daily allowance, given back when the service does
 * not answer. The rehearsal room uses Claude while the project's credit allowance lasts and falls
 * back to Groq, so it keeps working when the credit ends.
 */

import {
  failure,
  isRecord,
  ok,
  readArray,
  readOneOf,
  readOptionalString,
  readString,
  readUuid,
  RequestError,
  respondTo,
  type HandlerResult,
} from '../_shared/http.ts';
import {
  CompletionError,
  parseObject,
  type ChatTurn,
  type Completion,
  type CompletionRequest,
  type LanguageModel,
  wasGenerated,
} from '../_shared/llm.ts';
import { evidenceKey, feedbackFingerprint } from '../_shared/feedback-fingerprint.ts';
import { redactNames, type NameToHide } from '../_shared/redact.ts';
import type {
  CallerAccess,
  ClassNames,
  EvidenceRef,
  SahayakServices,
} from '../_shared/services.ts';
import {
  DEBRIEF_SCHEMA,
  debriefSystem,
  draftSchema,
  draftSystem,
  ORDER_SCHEMA,
  orderSystem,
  rehearsalSystem,
  SCORE_SCHEMA,
  scenarioByCode,
  scoreSystem,
  type Language,
} from './prompts.ts';

export const ACTIONS = [
  'draft_feedback',
  'score_feedback',
  'read_order',
  'rehearse',
  'debrief',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Requests each person may make a day. */
export const DAILY_LIMITS: Record<Action, number> = {
  draft_feedback: 20,
  score_feedback: 30,
  read_order: 15,
  rehearse: 120,
  debrief: 10,
};

/**
 * Requests a visitor of a demonstration district may make a day: enough to try every part, while
 * the services' free allowance is kept for real CRPs.
 */
export const DEMO_DAILY_LIMITS: Record<Action, number> = {
  draft_feedback: 5,
  score_feedback: 8,
  read_order: 3,
  rehearse: 30,
  debrief: 3,
};

/**
 * Requests all demonstration districts together may make a day, counted for the whole project, so
 * that many visitors at once cannot use up what real CRPs need.
 */
export const DEMO_PROJECT_LIMITS: Record<Action, number> = {
  draft_feedback: 60,
  score_feedback: 80,
  read_order: 20,
  rehearse: 300,
  debrief: 20,
};

/** Claude requests one person may make a day, so that the project's allowance is shared. */
export const CLAUDE_PER_PERSON = 60;

/** The identifier under which allowances shared by the whole project are counted. */
export const PROJECT_ID = '00000000-0000-0000-0000-000000000000';

export interface SahayakModels {
  /** Drafts, scores and debriefs: a model that follows a JSON schema strictly. */
  text: LanguageModel | null;
  /** Photos of orders. */
  vision: LanguageModel | null;
  /** The simulated teacher when Claude is not available. */
  chat: LanguageModel | null;
  /** The rehearsal room while the credit lasts. */
  claude: LanguageModel | null;
  /** Requests to Claude the whole project may make a day. */
  claudeDailyLimit: number;
}

const CODE = /^[a-z][a-z0-9-]{2,47}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** About 1.5 MB of picture, which a photo made smaller on the phone stays well below. */
const IMAGE_LIMIT = 2_000_000;

/** At most `limit` characters, cut at a word where possible. */
export function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  const characters = Array.from(clean);
  if (characters.length <= limit) {
    return clean;
  }
  const cut = characters.slice(0, limit - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${space > limit * 0.6 ? cut.slice(0, space) : cut}…`;
}

function dataBlock(value: unknown): string {
  return `<data>\n${JSON.stringify(value, null, 1)}\n</data>`;
}

function readInteger(source: Record<string, unknown>, field: string, min: number, max: number) {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RequestError('invalid_request', field);
  }
  return value;
}

function readOptionalInteger(
  source: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | null {
  return source[field] === undefined || source[field] === null
    ? null
    : readInteger(source, field, min, max);
}

function records(source: Record<string, unknown>, field: string, max: number) {
  return readArray(source, field, { min: 0, max }).map((entry) => {
    if (!isRecord(entry)) {
      throw new RequestError('invalid_request', field);
    }
    return entry;
  });
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    DATE.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/**
 * Asks a model within the person's daily allowance (a smaller one for a demonstration visitor, who
 * also shares one with every other visitor), giving the request back when nothing was generated.
 */
async function withAllowance(
  services: SahayakServices,
  caller: CallerAccess,
  action: Action,
  work: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const demonstration = await services.isDemonstration(caller.userId);
  const limit = demonstration ? DEMO_DAILY_LIMITS[action] : DAILY_LIMITS[action];
  if (!(await services.takeQuota(caller.userId, action, limit))) {
    return failure(429, 'quota_exceeded', { action, limit });
  }
  const shared = `demo_${action}`;
  if (
    demonstration &&
    !(await services.takeQuota(PROJECT_ID, shared, DEMO_PROJECT_LIMITS[action]))
  ) {
    await services.returnQuota(caller.userId, action).catch(() => undefined);
    return failure(429, 'quota_exceeded', { action, limit });
  }
  const giveBack = async () => {
    await services.returnQuota(caller.userId, action).catch(() => undefined);
    if (demonstration) {
      await services.returnQuota(PROJECT_ID, shared).catch(() => undefined);
    }
  };
  try {
    const result = await work();
    if (result.status >= 400) {
      // Refused before any service was asked.
      await giveBack();
    }
    return result;
  } catch (error) {
    // Given back when nothing was generated: the request was malformed, or the service failed or
    // turned it down. An answer that was generated but could not be used counts like any other,
    // or asking for unusable answers would cost nothing.
    if (!(error instanceof CompletionError && wasGenerated(error))) {
      await giveBack();
    }
    if (error instanceof CompletionError) {
      return failureOf(error);
    }
    throw error;
  }
}

function failureOf(error: CompletionError): HandlerResult {
  // The service, the reason and the HTTP status, for the function's logs; never any text.
  console.warn(`sahayak: ${error.message}`);
  switch (error.reason) {
    case 'not_configured':
      return failure(503, 'not_configured');
    case 'rejected':
    case 'refused':
      return failure(422, 'ai_refused');
    case 'exhausted':
      return failure(503, 'ai_unavailable', { retry_after_seconds: 3600 });
    case 'busy':
      return failure(503, 'ai_unavailable', { retry_after_seconds: 60 });
    case 'unavailable':
      return failure(503, 'ai_unavailable', { retry_after_seconds: 20 });
  }
}

function needModel(model: LanguageModel | null): LanguageModel {
  if (!model) {
    throw new CompletionError('not_configured', 'groq', 'no model');
  }
  return model;
}

// ---------------------------------------------------------------------------------------------
// draft_feedback
// ---------------------------------------------------------------------------------------------

function hiddenNames(names: ClassNames): NameToHide[] {
  return [
    ...names.children.map((name) => ({ name, label: '[child]' })),
    ...names.teachers.map((name) => ({ name, label: '[teacher]' })),
  ];
}

/**
 * The phone takes names out before sending; the function does it again with the class's full
 * list, so that a list the phone did not have, or a teacher who has moved on, is covered too.
 * Texts are read with room for the labels, then cut to the database's limits.
 */
async function draftFeedback(
  body: Record<string, unknown>,
  language: Language,
  services: SahayakServices,
  models: SahayakModels,
): Promise<HandlerResult> {
  const visit = isRecord(body.visit) ? body.visit : null;
  if (!visit) {
    throw new RequestError('invalid_request', 'visit');
  }
  const names = await services.namesOfClass(
    readUuid(visit, 'class_section_id'),
    visit.teacher_id === null || visit.teacher_id === undefined
      ? null
      : readUuid(visit, 'teacher_id'),
  );
  if (!names) {
    return failure(404, 'not_found', { field: 'class_section_id' });
  }
  const hidden = hiddenNames(names);
  const hide = (text: string | null, limit: number) =>
    text ? clip(redactNames(text, hidden), limit) : null;
  const focus = records(visit, 'focus', 5).map((entry) => ({
    code: readString(entry, 'code', { maxLength: 48, pattern: CODE }),
    text: readString(entry, 'text', { maxLength: 200 }),
    answer:
      entry.answer === null || entry.answer === undefined
        ? null
        : readOneOf(entry, 'answer', ['yes', 'no', 'not_seen'] as const),
    note: hide(readOptionalString(entry, 'note', { maxLength: 450 }), 300),
  }));
  const moments = records(visit, 'moments', 60).map((entry) => ({
    id: readUuid(entry, 'id'),
    tag: readString(entry, 'tag', { maxLength: 120 }),
    tone: readOneOf(entry, 'tone', ['strength', 'concern'] as const),
    minute: readInteger(entry, 'minute', 0, 720),
    note: hide(readOptionalString(entry, 'note', { maxLength: 300 }), 200),
  }));
  const practices = readArray(visit, 'practices', { min: 1, max: 24 }).map((entry) => {
    if (!isRecord(entry)) {
      throw new RequestError('invalid_request', 'practices');
    }
    return {
      code: readString(entry, 'code', { maxLength: 48, pattern: CODE }),
      title: readString(entry, 'title', { maxLength: 120 }),
      why: readString(entry, 'why', { maxLength: 400 }),
    };
  });
  const pulse = isRecord(visit.pulse)
    ? {
        checked: readInteger(visit.pulse, 'checked', 0, 100),
        needs_support: readInteger(visit.pulse, 'needs_support', 0, 100),
        hesitant: readInteger(visit.pulse, 'hesitant', 0, 100),
        fluent: readInteger(visit.pulse, 'fluent', 0, 100),
        english_no_response: readInteger(visit.pulse, 'english_no_response', 0, 100),
      }
    : null;
  const followUp = isRecord(visit.follow_up)
    ? {
        practice: readString(visit.follow_up, 'practice', { maxLength: 120 }),
        result:
          visit.follow_up.result === null || visit.follow_up.result === undefined
            ? null
            : readOneOf(visit.follow_up, 'result', ['practised', 'partly', 'not_yet'] as const),
      }
    : null;
  const context = {
    class: readOptionalInteger(visit, 'grade', 1, 8),
    lesson: hide(readOptionalString(visit, 'lesson', { maxLength: 240 }), 160),
    focus_items: focus,
    moments,
    pulse_this_month: pulse,
    earlier_step: followUp,
    voice_note: hide(readOptionalString(visit, 'transcript', { maxLength: 12000 }), 8000),
    practices,
  };
  if (focus.length === 0 && moments.length === 0 && !context.voice_note) {
    // Nothing was observed yet: a draft could only be invented.
    throw new RequestError('invalid_request', 'visit');
  }

  // A strength rests on what went well: moments of strength, and items seen in the lesson. These
  // are the only evidence the form lets the CRP choose.
  const momentIds = moments
    .filter((moment) => moment.tone === 'strength')
    .map((moment) => moment.id);
  const itemCodes = focus.filter((item) => item.answer === 'yes').map((item) => item.code);
  const practiceCodes = practices.map((practice) => practice.code);
  const model = needModel(models.text);
  const answer = parseObject(
    await model.complete({
      system: draftSystem(language),
      turns: [{ role: 'user', content: dataBlock(context) }],
      schema: draftSchema(momentIds, itemCodes, practiceCodes),
      // Room for the model's reasoning and a long answer in Hindi. Free plans count the whole
      // allowance against their tokens per minute, so it is not larger than the answer needs.
      maxTokens: 4000,
      effort: 'medium',
    }),
  );

  const strength = typeof answer.strength === 'string' ? clip(answer.strength, 500) : '';
  const practiceCode =
    typeof answer.practice_code === 'string' && practiceCodes.includes(answer.practice_code)
      ? answer.practice_code
      : null;
  if (!strength || !practiceCode) {
    throw new CompletionError('refused', model.provider, 'incomplete draft');
  }
  // Only evidence that exists in this visit is kept, each once.
  const evidence: EvidenceRef[] = [
    ...new Set(Array.isArray(answer.evidence_moments) ? answer.evidence_moments : []),
  ]
    .filter((id): id is string => typeof id === 'string' && momentIds.includes(id))
    .map((id) => ({ moment: id }) as EvidenceRef)
    .concat(
      [...new Set(Array.isArray(answer.evidence_items) ? answer.evidence_items : [])]
        .filter((code): code is string => typeof code === 'string' && itemCodes.includes(code))
        .map((code) => ({ item: code })),
    )
    .slice(0, 8);
  const days =
    typeof answer.check_back_days === 'number' && Number.isFinite(answer.check_back_days)
      ? Math.min(42, Math.max(3, Math.round(answer.check_back_days)))
      : 14;
  const text = (value: unknown, limit: number) =>
    typeof value === 'string' && value.trim() ? clip(value, limit) : null;
  return ok({
    draft: {
      strength,
      evidence,
      practice_code: practiceCode,
      change_note: text(answer.change_note, 500),
      technique: text(answer.technique, 1000),
      plan_note: text(answer.plan_note, 1000),
      check_back_days: days,
    },
    model: model.model,
  });
}

// ---------------------------------------------------------------------------------------------
// score_feedback
// ---------------------------------------------------------------------------------------------

/** The parts of the rubric that are counted rather than judged. */
export function countedParts(feedback: {
  evidence: readonly unknown[];
  demoGiven: boolean;
  technique: string | null;
  visitedOn: string;
  checkBackOn: string;
}): { evidence: number; demonstration: number; checkBack: number } {
  const days = daysBetween(feedback.visitedOn, feedback.checkBackOn);
  return {
    evidence: Math.min(2, feedback.evidence.length),
    demonstration: feedback.demoGiven ? 2 : (feedback.technique?.trim().length ?? 0) >= 80 ? 1 : 0,
    checkBack: days <= 14 ? 2 : days <= 21 ? 1 : 0,
  };
}

function scoreBody(score: {
  specific: number;
  evidence: number;
  oneFocus: number;
  demonstration: number;
  checkBack: number;
  respectful: number;
  total: number;
  tip: string;
  language: string;
  feedbackAgreedAt: string;
  feedbackFingerprint: string;
  scoredAt: string;
}) {
  return {
    specific: score.specific,
    evidence: score.evidence,
    one_focus: score.oneFocus,
    demonstration: score.demonstration,
    check_back: score.checkBack,
    respectful: score.respectful,
    total: score.total,
    tip: score.tip,
    language: score.language,
    feedback_agreed_at: score.feedbackAgreedAt,
    feedback_fingerprint: score.feedbackFingerprint,
    scored_at: score.scoredAt,
  };
}

async function scoreFeedback(
  body: Record<string, unknown>,
  caller: CallerAccess,
  services: SahayakServices,
  models: SahayakModels,
): Promise<HandlerResult> {
  const visitId = readUuid(body, 'visit_id');
  const feedback = await services.agreedFeedback(visitId, caller.userId);
  if (!feedback) {
    return failure(404, 'not_found', { field: 'visit_id' });
  }
  // Feedback already scored as it stands is not sent again.
  const fingerprint = await feedbackFingerprint({
    strength: feedback.strength,
    evidence: feedback.evidence.map(evidenceKey),
    practiceCode: feedback.practiceCode,
    changeNote: feedback.changeNote,
    technique: feedback.technique,
    demoGiven: feedback.demoGiven,
    planNote: feedback.planNote,
    checkBackOn: feedback.checkBackOn,
  });
  const held = await services.storedScore(visitId);
  if (held && held.feedbackFingerprint === fingerprint) {
    return ok({ score: scoreBody(held), cached: true });
  }

  return withAllowance(services, caller, 'score_feedback', async () => {
    const hidden = hiddenNames(await services.namesOfVisit(visitId));
    const hide = (text: string | null) => (text ? redactNames(text, hidden) : null);
    const cited = new Set(
      feedback.evidence.flatMap((entry) => ('moment' in entry ? [entry.moment] : [])),
    );
    const context = {
      lesson: hide(feedback.lessonNote),
      strength: hide(feedback.strength),
      evidence_cited: feedback.moments
        .filter((moment) => cited.has(moment.id))
        .map((moment) => ({ tag: moment.tagCode, note: hide(moment.note) })),
      focus_items_cited: feedback.evidence.flatMap((entry) =>
        'item' in entry ? [entry.item] : [],
      ),
      practice: feedback.practiceCode,
      change: hide(feedback.changeNote),
      technique: hide(feedback.technique),
      demonstrated_in_class: feedback.demoGiven,
      plan: hide(feedback.planNote),
      check_back_in_days: daysBetween(feedback.visitedOn, feedback.checkBackOn),
    };
    const model = needModel(models.text);
    const answer = parseObject(
      await model.complete({
        system: scoreSystem(feedback.language),
        turns: [{ role: 'user', content: dataBlock(context) }],
        schema: SCORE_SCHEMA,
        maxTokens: 2500,
        effort: 'medium',
      }),
    );
    const part = (value: unknown) =>
      typeof value === 'number' && [0, 1, 2].includes(value) ? value : null;
    const specific = part(answer.specific);
    const oneFocus = part(answer.one_focus);
    const respectful = part(answer.respectful);
    const tip = typeof answer.tip === 'string' ? clip(answer.tip, 400) : '';
    if (specific === null || oneFocus === null || respectful === null || !tip) {
      throw new CompletionError('refused', model.provider, 'incomplete score');
    }
    const saved = await services.saveScore(
      {
        visitId,
        specific,
        oneFocus,
        respectful,
        ...countedParts(feedback),
        tip,
        language: feedback.language,
        model: clip(model.model, 80),
        feedbackAgreedAt: feedback.agreedAt,
        feedbackFingerprint: fingerprint,
      },
      caller.userId,
    );
    return ok({ score: scoreBody(saved), cached: false });
  });
}

// ---------------------------------------------------------------------------------------------
// read_order
// ---------------------------------------------------------------------------------------------

async function readOrder(
  body: Record<string, unknown>,
  language: Language,
  models: SahayakModels,
  today: string,
): Promise<HandlerResult> {
  const mediaType = readOneOf(body, 'media_type', [
    'image/jpeg',
    'image/png',
    'image/webp',
  ] as const);
  const image = body.image;
  if (
    typeof image !== 'string' ||
    image.length < 100 ||
    image.length > IMAGE_LIMIT ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(image)
  ) {
    throw new RequestError('invalid_request', 'image');
  }
  const model = needModel(models.vision);
  const answer = parseObject(
    await model.complete({
      system: orderSystem(language, today),
      turns: [{ role: 'user', content: 'List the tasks in this order.' }],
      image: { mediaType, base64: image },
      schema: ORDER_SCHEMA,
      maxTokens: 1500,
      effort: 'medium',
    }),
  );
  // A deadline is kept only when it is a real date in the coming year (or just past).
  const due = (value: unknown) =>
    isCalendarDate(value) && value >= addDays(today, -30) && value <= addDays(today, 366)
      ? value
      : null;
  const tasks = (Array.isArray(answer.tasks) ? answer.tasks : [])
    .filter(isRecord)
    .map((task) => ({
      title: typeof task.title === 'string' ? clip(task.title, 200) : '',
      details:
        typeof task.details === 'string' && task.details.trim() ? clip(task.details, 2000) : null,
      due_on: due(task.due_on),
    }))
    .filter((task) => task.title !== '')
    .slice(0, 10);
  return ok({
    readable: answer.readable === true && tasks.length > 0,
    issuer:
      typeof answer.issuer === 'string' && answer.issuer.trim() ? clip(answer.issuer, 120) : null,
    order_date: isCalendarDate(answer.order_date) ? answer.order_date : null,
    tasks: answer.readable === true ? tasks : [],
  });
}

// ---------------------------------------------------------------------------------------------
// rehearse and debrief
// ---------------------------------------------------------------------------------------------

/** The conversation so far, checked: the CRP and the teacher take turns, the CRP last. */
function readConversation(body: Record<string, unknown>, minimumCrpTurns: number): ChatTurn[] {
  const messages = readArray(body, 'messages', { min: 1, max: 40 });
  const turns: ChatTurn[] = messages.map((entry) => {
    if (!isRecord(entry)) {
      throw new RequestError('invalid_request', 'messages');
    }
    const role = readOneOf(entry, 'role', ['crp', 'teacher'] as const);
    return {
      role: role === 'crp' ? 'user' : 'assistant',
      content: readString(entry, 'text', { maxLength: 800 }),
    };
  });
  for (let index = 1; index < turns.length; index += 1) {
    if (turns[index]?.role === turns[index - 1]?.role) {
      throw new RequestError('invalid_request', 'messages');
    }
  }
  if (turns.at(-1)?.role !== 'user') {
    throw new RequestError('invalid_request', 'messages');
  }
  if (turns.filter((turn) => turn.role === 'user').length < minimumCrpTurns) {
    throw new RequestError('invalid_request', 'messages');
  }
  // The teacher speaks first in the room; the services expect the conversation to start with the
  // other side, so the CRP's arrival is stated.
  return turns[0]?.role === 'assistant'
    ? [{ role: 'user', content: '(The CRP sits down with you after the lesson.)' }, ...turns]
    : turns;
}

/**
 * Asks Claude while the person's share and the project's allowance last, and Groq otherwise or
 * when Claude cannot answer: the credit running out never stops the rehearsal room. Only a
 * request Claude answered (also with an answer that could not be used), or one refused because the
 * credit is used up, stays counted. Visitors
 * of a demonstration district always rehearse with Groq, so that the credit is kept for real CRPs.
 */
async function withRehearsalModel(
  services: SahayakServices,
  caller: CallerAccess,
  models: SahayakModels,
  fallback: LanguageModel | null,
  request: CompletionRequest,
): Promise<Completion> {
  if (
    models.claude &&
    !(await services.isDemonstration(caller.userId)) &&
    (await services.takeQuota(caller.userId, 'claude', CLAUDE_PER_PERSON))
  ) {
    if (await services.takeQuota(PROJECT_ID, 'claude', models.claudeDailyLimit)) {
      try {
        return await models.claude.complete(request);
      } catch (error) {
        if (!(error instanceof CompletionError)) {
          throw error;
        }
        // Claude's credit is spent on an answer it generated, and the credit that ran out stays
        // counted; anything else is given back.
        if (error.reason !== 'exhausted' && !wasGenerated(error)) {
          await services.returnQuota(PROJECT_ID, 'claude').catch(() => undefined);
          await services.returnQuota(caller.userId, 'claude').catch(() => undefined);
        }
      }
    } else {
      await services.returnQuota(caller.userId, 'claude').catch(() => undefined);
    }
  }
  return needModel(fallback).complete(request);
}

async function rehearse(
  body: Record<string, unknown>,
  language: Language,
  caller: CallerAccess,
  services: SahayakServices,
  models: SahayakModels,
): Promise<HandlerResult> {
  const scenario = scenarioByCode(readString(body, 'scenario', { maxLength: 48, pattern: CODE }));
  if (!scenario) {
    throw new RequestError('invalid_request', 'scenario');
  }
  const turns = readConversation(body, 1);
  if (turns.filter((turn) => turn.role === 'user').length > 20) {
    // A conversation this long has run its course; the room asks for the debrief.
    throw new RequestError('invalid_request', 'messages');
  }
  const completion = await withRehearsalModel(services, caller, models, models.chat, {
    system: rehearsalSystem(scenario, language),
    turns,
    maxTokens: 1000,
    effort: 'low',
  });
  return ok({ reply: clip(completion.text, 800), provider: completion.provider });
}

async function debrief(
  body: Record<string, unknown>,
  language: Language,
  caller: CallerAccess,
  services: SahayakServices,
  models: SahayakModels,
): Promise<HandlerResult> {
  const scenario = scenarioByCode(readString(body, 'scenario', { maxLength: 48, pattern: CODE }));
  if (!scenario) {
    throw new RequestError('invalid_request', 'scenario');
  }
  const messages = readArray(body, 'messages', { min: 1, max: 41 });
  // The teacher's last line may close the conversation; it is part of what is reviewed.
  const conversation = messages.map((entry) => {
    if (!isRecord(entry)) {
      throw new RequestError('invalid_request', 'messages');
    }
    return {
      speaker: readOneOf(entry, 'role', ['crp', 'teacher'] as const),
      text: readString(entry, 'text', { maxLength: 800 }),
    };
  });
  const crpTurns = conversation.filter((entry) => entry.speaker === 'crp').length;
  if (crpTurns < 2) {
    throw new RequestError('invalid_request', 'messages');
  }
  const completion = await withRehearsalModel(services, caller, models, models.text, {
    system: debriefSystem(scenario, language),
    turns: [{ role: 'user', content: dataBlock(conversation) }],
    schema: DEBRIEF_SCHEMA,
    maxTokens: 4000,
    effort: 'medium',
  });
  const answer = parseObject(completion);
  const checks = [
    'named_practice',
    'asked_constraints',
    'agreed_check_back',
    'kept_blame_out',
    'cited_evidence',
  ] as const;
  const wentWell = typeof answer.went_well === 'string' ? clip(answer.went_well, 600) : '';
  const tryNext = typeof answer.try_next === 'string' ? clip(answer.try_next, 600) : '';
  if (checks.some((check) => typeof answer[check] !== 'boolean') || !wentWell || !tryNext) {
    throw new CompletionError('refused', completion.provider, 'incomplete debrief');
  }
  const saved = await services.saveDebrief(
    {
      scenario: scenario.code,
      language,
      turns: Math.min(40, crpTurns),
      namedPractice: answer.named_practice === true,
      askedConstraints: answer.asked_constraints === true,
      agreedCheckBack: answer.agreed_check_back === true,
      keptBlameOut: answer.kept_blame_out === true,
      citedEvidence: answer.cited_evidence === true,
      wentWell,
      tryNext,
      provider: completion.provider,
    },
    caller.userId,
  );
  return ok({
    debrief: {
      id: saved.id,
      scenario: saved.scenario,
      language: saved.language,
      turns: saved.turns,
      named_practice: saved.namedPractice,
      asked_constraints: saved.askedConstraints,
      agreed_check_back: saved.agreedCheckBack,
      kept_blame_out: saved.keptBlameOut,
      cited_evidence: saved.citedEvidence,
      went_well: saved.wentWell,
      try_next: saved.tryNext,
      provider: saved.provider,
      created_at: saved.createdAt,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------------------------

export function handleSahayak(
  body: unknown,
  caller: CallerAccess,
  services: SahayakServices,
  models: SahayakModels,
  today: string,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (
      caller.passwordChangeRequired ||
      (caller.crpClusterIds.length === 0 && !caller.isSuperAdmin)
    ) {
      return failure(403, 'forbidden');
    }
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    const action = readOneOf(body, 'action', ACTIONS);
    const language = readOneOf(body, 'language', ['hi', 'en'] as const);
    if (!models.text) {
      // Without the everyday service nothing can be offered, not even the rehearsal fallback.
      return failure(503, 'not_configured');
    }
    switch (action) {
      case 'draft_feedback':
        return await withAllowance(services, caller, action, () =>
          draftFeedback(body, language, services, models),
        );
      case 'score_feedback':
        return await scoreFeedback(body, caller, services, models);
      case 'read_order':
        return await withAllowance(services, caller, action, () =>
          readOrder(body, language, models, today),
        );
      case 'rehearse':
        return await withAllowance(services, caller, action, () =>
          rehearse(body, language, caller, services, models),
        );
      case 'debrief':
        return await withAllowance(services, caller, action, () =>
          debrief(body, language, caller, services, models),
        );
    }
  });
}
