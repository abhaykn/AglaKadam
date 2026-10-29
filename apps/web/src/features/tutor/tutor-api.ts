import type { TFunction } from 'i18next';
import { callFunction, FunctionCallError } from '@/lib/functions';

/**
 * The application's side of Disha, the learning guide. Every question goes through the `disha`
 * Edge Function, needs a network and is never queued: an answer an hour later is of no use in a
 * conversation.
 */

export const TUTOR_PERSONAS = ['family', 'teacher', 'crp', 'officer', 'admin'] as const;
export type TutorPersona = (typeof TUTOR_PERSONAS)[number];

export type TutorProvider = 'claude' | 'groq';
export type TutorLanguage = 'hi' | 'en';

/** The function accepts this many characters in one message, and this many messages. */
export const MESSAGE_LIMIT = 1500;
const TURNS_SENT = 16;

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The service that wrote an answer. */
  provider?: TutorProvider;
}

interface TutorAnswer {
  reply: string;
  provider: TutorProvider;
  fell_back: boolean;
}

/** The function takes this many characters of a conversation in all; the client stays below. */
const CONVERSATION_BUDGET = 12_000;

/**
 * The latest turns of a conversation that fit what the function accepts, beginning with a message
 * of the person: older turns are left out first.
 */
export function turnsToSend(messages: readonly TutorMessage[]): { role: string; text: string }[] {
  let recent = messages.slice(-TURNS_SENT);
  const size = (turns: readonly TutorMessage[]) =>
    turns.reduce((total, turn) => total + turn.text.length, 0);
  while (recent.length > 1 && size(recent) > CONVERSATION_BUDGET) {
    recent = recent.slice(1);
  }
  const first = recent.findIndex((message) => message.role === 'user');
  return recent.slice(Math.max(0, first)).map(({ role, text }) => ({ role, text }));
}

export async function askDisha(input: {
  persona: TutorPersona;
  language: TutorLanguage;
  messages: readonly TutorMessage[];
}): Promise<{ text: string; provider: TutorProvider }> {
  const answer = await callFunction<TutorAnswer>('disha', {
    action: 'chat',
    persona: input.persona,
    language: input.language,
    messages: turnsToSend(input.messages),
  });
  return { text: answer.reply, provider: answer.provider };
}

/** Why Disha could not answer, in words for the person. */
export function tutorError(error: unknown, t: TFunction): string {
  const code = error instanceof FunctionCallError ? error.code : 'internal_error';
  switch (code) {
    case 'network':
      return t('tutor.errors.network');
    case 'not_configured':
      return t('tutor.errors.notConfigured');
    case 'quota_exceeded':
      return t('tutor.errors.quota');
    case 'ai_unavailable':
      return t('tutor.errors.unavailable');
    case 'ai_refused':
      return t('tutor.errors.refused');
    case 'forbidden':
      return t('tutor.errors.forbidden');
    case 'invalid_request':
      return t('tutor.errors.tooLong');
    default:
      return t('tutor.errors.other');
  }
}
