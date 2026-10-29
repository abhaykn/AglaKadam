import type { QueryClient } from '@tanstack/react-query';
import { sessionStore, type SessionState } from '@/features/auth/session';

/** The signed-in user; undefined while the stored session is still being read. */
function userOf(state: SessionState): string | null | undefined {
  if (state.status === 'loading') {
    return undefined;
  }
  return state.status === 'signed-in' ? state.userId : null;
}

/**
 * Clears every cached query whenever the signed-in user changes, however the change happens
 * (signing out here or in another tab, a session that expires or is revoked), so that nothing the
 * previous user could see is ever shown to the next one on a shared device.
 *
 * It runs as the session changes, before anything renders for the new state, so that not even one
 * screen can show the previous user's data. Returns the function that stops it.
 */
export function forgetPreviousUser(queryClient: QueryClient): () => void {
  let previous = userOf(sessionStore.get()) ?? null;
  return sessionStore.subscribe(() => {
    const current = userOf(sessionStore.get());
    if (current === undefined) {
      return;
    }
    // Only a user who was signed in can have left data behind; the first sign-in finds none.
    if (previous !== null && previous !== current) {
      queryClient.clear();
    }
    previous = current;
  });
}
