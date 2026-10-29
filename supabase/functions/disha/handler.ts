/**
 * Disha, the learning guide of the application: a conversation about learning and teaching that
 * every signed-in person can have, in the manner of their own role. One action, `chat`, takes the
 * conversation so far and answers its last message.
 *
 * Claude is asked first while the person's share and the project's daily allowance last; when it
 * cannot answer (its credit is spent, its key is gone, it is busy or down) the answer comes from
 * Groq, and a service that is known to be out is left alone for a while. Each question takes one
 * request from the person's daily allowance, given back when no service answered.
 */

import {
  failure,
  isRecord,
  ok,
  readArray,
  readOneOf,
  readString,
  RequestError,
  respondTo,
  type HandlerResult,
} from '../_shared/http.ts';
import {
  askWithFallback,
  PROJECT_ID,
  ProviderBreaker,
  type FirstChoice,
} from '../_shared/failover.ts';
import {
  CompletionError,
  type ChatTurn,
  type CompletionRequest,
  type LanguageModel,
} from '../_shared/llm.ts';
import type { CallerAccess, SahayakServices } from '../_shared/services.ts';
import { PERSONAS, tutorSystem, type Persona } from './prompts.ts';
import { scrubPersonalDetails } from './scrub.ts';

/** Questions each person may ask a day. */
export const DAILY_LIMIT = 80;
/** Questions a visitor of a demonstration district may ask a day. */
export const DEMO_DAILY_LIMIT = 25;
/** Questions all demonstration districts together may ask a day. */
export const DEMO_PROJECT_LIMIT = 400;
/** Claude requests one person may make a day, so that the project's allowance is shared. */
export const CLAUDE_PER_PERSON = 60;

const MAX_TURNS = 24;
/** What a person may write in one message; the guide's own replies may be longer. */
const MAX_QUESTION_CHARACTERS = 1500;
const MAX_CONVERSATION_CHARACTERS = 14_000;
const MAX_REPLY_CHARACTERS = 4000;

export interface DishaModels {
  /** The first choice. */
  claude: LanguageModel | null;
  /** The fallbacks, in order: when one is busy, the next is tried. */
  groq: readonly LanguageModel[];
  /** Requests to Claude the whole project may make a day. */
  claudeDailyLimit: number;
  breaker: ProviderBreaker;
}

export type DishaServices = Pick<SahayakServices, 'takeQuota' | 'returnQuota' | 'isDemonstration'>;

/** The kinds of person the caller may speak as, in the order of their importance. */
export function personasOf(caller: CallerAccess): Persona[] {
  if (caller.accountKind === 'student') {
    return ['family'];
  }
  const personas: Persona[] = [];
  if (caller.isSuperAdmin) {
    personas.push('admin');
  }
  if (caller.crpClusterIds.length > 0) {
    personas.push('crp');
  }
  if (caller.teacherSchoolIds.length > 0) {
    personas.push('teacher');
  }
  // A staff account that is neither teacher nor CRP nor administrator is an officer of the
  // education office.
  if (personas.length === 0 || caller.isSuperAdmin) {
    personas.push('officer');
  }
  return personas;
}

/** At most `limit` characters, cut at a word where possible. */
function clip(text: string, limit: number): string {
  const clean = text.trim();
  const characters = Array.from(clean);
  if (characters.length <= limit) {
    return clean;
  }
  const cut = characters.slice(0, limit - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${space > limit * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** The conversation, checked and cleaned: the person and the guide take turns, the person last. */
function readConversation(body: Record<string, unknown>): ChatTurn[] {
  const messages = readArray(body, 'messages', { min: 1, max: MAX_TURNS });
  let total = 0;
  const turns = messages.map((entry): ChatTurn => {
    if (!isRecord(entry)) {
      throw new RequestError('invalid_request', 'messages');
    }
    const role = readOneOf(entry, 'role', ['user', 'assistant'] as const);
    const text = readString(entry, 'text', {
      maxLength: role === 'user' ? MAX_QUESTION_CHARACTERS : MAX_REPLY_CHARACTERS,
    });
    total += text.length;
    return { role, content: scrubPersonalDetails(text) };
  });
  if (total > MAX_CONVERSATION_CHARACTERS || turns.at(-1)?.role !== 'user') {
    throw new RequestError('invalid_request', 'messages');
  }
  for (let index = 1; index < turns.length; index += 1) {
    if (turns[index]?.role === turns[index - 1]?.role) {
      throw new RequestError('invalid_request', 'messages');
    }
  }
  // The services expect a conversation to begin with the person.
  return turns[0]?.role === 'assistant'
    ? [{ role: 'user', content: '(The conversation begins.)' }, ...turns]
    : turns;
}

function failureOf(error: CompletionError): HandlerResult {
  // The service, the reason and the HTTP status, for the function's logs; never any text.
  console.warn(`disha: ${error.message}`);
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

async function chat(
  body: Record<string, unknown>,
  caller: CallerAccess,
  services: DishaServices,
  models: DishaModels,
): Promise<HandlerResult> {
  const language = readOneOf(body, 'language', ['hi', 'en'] as const);
  const persona = readOneOf(body, 'persona', PERSONAS);
  if (!personasOf(caller).includes(persona)) {
    return failure(403, 'forbidden');
  }
  const turns = readConversation(body);

  const demonstration = await services.isDemonstration(caller.userId);
  const limit = demonstration ? DEMO_DAILY_LIMIT : DAILY_LIMIT;
  if (!(await services.takeQuota(caller.userId, 'tutor', limit))) {
    return failure(429, 'quota_exceeded', { action: 'chat', limit });
  }
  if (demonstration && !(await services.takeQuota(PROJECT_ID, 'demo_tutor', DEMO_PROJECT_LIMIT))) {
    await services.returnQuota(caller.userId, 'tutor').catch(() => undefined);
    return failure(429, 'quota_exceeded', { action: 'chat', limit });
  }
  const giveBack = async () => {
    await services.returnQuota(caller.userId, 'tutor').catch(() => undefined);
    if (demonstration) {
      await services.returnQuota(PROJECT_ID, 'demo_tutor').catch(() => undefined);
    }
  };

  const request: CompletionRequest = {
    system: tutorSystem(persona, language),
    turns,
    // Room for a model that thinks first and for an answer in Hindi, which takes more tokens.
    maxTokens: 1600,
    effort: 'low',
  };
  const first: FirstChoice | null = models.claude
    ? {
        model: models.claude,
        perPerson: CLAUDE_PER_PERSON,
        perProject: models.claudeDailyLimit,
      }
    : null;
  try {
    const answer = await askWithFallback(
      services,
      models.breaker,
      caller.userId,
      first,
      models.groq,
      request,
    );
    return ok({
      reply: clip(answer.text, MAX_REPLY_CHARACTERS),
      provider: answer.provider,
      fell_back: answer.fellBack,
    });
  } catch (error) {
    // Given back unless a service generated an answer that could not be used.
    if (!(error instanceof CompletionError && error.reason === 'refused')) {
      await giveBack();
    }
    if (error instanceof CompletionError) {
      return failureOf(error);
    }
    throw error;
  }
}

export function handleDisha(
  body: unknown,
  caller: CallerAccess,
  services: DishaServices,
  models: DishaModels,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (caller.passwordChangeRequired) {
      return failure(403, 'forbidden');
    }
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    readOneOf(body, 'action', ['chat'] as const);
    if (!models.claude && models.groq.length === 0) {
      return failure(503, 'not_configured');
    }
    return await chat(body, caller, services, models);
  });
}
