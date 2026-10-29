import { createStore } from '@/lib/store';
import { askDisha, type TutorLanguage, type TutorMessage, type TutorPersona } from './tutor-api';

/**
 * The conversations with Disha, one for each kind of person the account speaks as. They live in
 * memory only: nothing is stored on the device, and a conversation ends when the account changes
 * or the page is closed.
 */

interface TutorState {
  userId: string | null;
  chats: Partial<Record<TutorPersona, TutorMessage[]>>;
  /** The conversation that is waiting for an answer. */
  pending: TutorPersona | null;
  /** The reason the last question was not answered, for the conversation it belongs to. */
  failure: { persona: TutorPersona; error: unknown } | null;
}

const EMPTY: TutorState = { userId: null, chats: {}, pending: null, failure: null };

export const tutorStore = createStore<TutorState>(EMPTY);

let counter = 0;
function newId(): string {
  counter += 1;
  return `m${String(Date.now())}-${String(counter)}`;
}

/** Forgets every conversation, when the person signs out. */
export function endConversations(): void {
  tutorStore.set(EMPTY);
}

/** Starts afresh when a different account is using the device. */
export function adoptAccount(userId: string): void {
  if (tutorStore.get().userId !== userId) {
    tutorStore.set({ ...EMPTY, userId });
  }
}

export function messagesOf(state: TutorState, persona: TutorPersona): readonly TutorMessage[] {
  return state.chats[persona] ?? [];
}

/** Ends the conversation of the given kind of person. */
export function clearConversation(persona: TutorPersona): void {
  tutorStore.set((state) => ({
    ...state,
    chats: { ...state.chats, [persona]: [] },
    failure: state.failure?.persona === persona ? null : state.failure,
  }));
}

async function ask(userId: string, persona: TutorPersona, language: TutorLanguage): Promise<void> {
  const messages = messagesOf(tutorStore.get(), persona);
  tutorStore.set((state) => ({ ...state, pending: persona, failure: null }));
  try {
    const answer = await askDisha({ persona, language, messages });
    // The account may have changed, or the conversation been cleared, while waiting.
    if (tutorStore.get().userId !== userId) {
      return;
    }
    tutorStore.set((state) => ({
      ...state,
      pending: null,
      chats: {
        ...state.chats,
        [persona]: [
          ...messagesOf(state, persona),
          { id: newId(), role: 'assistant', text: answer.text, provider: answer.provider },
        ],
      },
    }));
  } catch (error) {
    if (tutorStore.get().userId !== userId) {
      return;
    }
    tutorStore.set((state) => ({ ...state, pending: null, failure: { persona, error } }));
  }
}

/** Adds the person's message to the conversation and asks Disha to answer it. */
export async function sendMessage(
  userId: string,
  persona: TutorPersona,
  language: TutorLanguage,
  text: string,
): Promise<void> {
  const clean = text.trim();
  if (clean === '' || tutorStore.get().pending !== null) {
    return;
  }
  adoptAccount(userId);
  tutorStore.set((state) => {
    const earlier = messagesOf(state, persona);
    // A question that was never answered (the service failed) gives way to the new one: the
    // function takes the person and the guide in turn, and the person has moved on.
    const kept = earlier.at(-1)?.role === 'user' ? earlier.slice(0, -1) : earlier;
    return {
      ...state,
      chats: { ...state.chats, [persona]: [...kept, { id: newId(), role: 'user', text: clean }] },
      failure: state.failure?.persona === persona ? null : state.failure,
    };
  });
  await ask(userId, persona, language);
}

/** Asks again for the last message, after a failure. */
export async function retryLast(
  userId: string,
  persona: TutorPersona,
  language: TutorLanguage,
): Promise<void> {
  const state = tutorStore.get();
  if (state.pending !== null || messagesOf(state, persona).at(-1)?.role !== 'user') {
    return;
  }
  await ask(userId, persona, language);
}
