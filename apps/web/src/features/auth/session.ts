import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { authStorage } from '@/lib/session-storage';
import { createStore } from '@/lib/store';
import { getSupabase, SESSION_STORAGE_KEY } from '@/lib/supabase';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; userId: string; email: string | null };

export const sessionStore = createStore<SessionState>({ status: 'loading' });

/** User of the session kept in storage, read without contacting the Auth service. */
async function storedSessionUser(): Promise<{ id: string; email: string | null } | null> {
  let raw: string | null;
  try {
    raw = await authStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { user?: { id?: unknown; email?: unknown } };
    const id = parsed.user?.id;
    if (typeof id !== 'string') {
      return null;
    }
    return { id, email: typeof parsed.user?.email === 'string' ? parsed.user.email : null };
  } catch {
    return null;
  }
}

/**
 * How long start-up waits for the Auth client before using the stored session. Refreshing an expired
 * token on a poor connection is retried for up to about 25 seconds, which must not hold up the app.
 */
export const SESSION_RESTORE_WAIT_MS = 3000;

let initialisation: Promise<void> | null = null;
let listening = false;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Restores the session once per page load and keeps {@link sessionStore} in step with the Auth
 * client afterwards.
 *
 * When the access token has expired and the device is offline, the Auth client cannot refresh it
 * but keeps the session in storage. The user stays signed in in that case: their work is saved on the
 * device and the session is refreshed as soon as the network returns. Offline, or when the Auth
 * client takes longer than {@link SESSION_RESTORE_WAIT_MS}, the stored session is used at once and
 * the Auth client's answer, when it comes, takes over.
 */
export function initialiseSession(): Promise<void> {
  if (initialisation) {
    return initialisation;
  }
  const supabase = getSupabase();

  if (!listening) {
    listening = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        sessionStore.set({
          status: 'signed-in',
          userId: session.user.id,
          email: session.user.email ?? null,
        });
      } else if (sessionStore.get().status !== 'loading') {
        sessionStore.set({ status: 'signed-out' });
      }
    });
  }

  const starting = (async () => {
    const stored = await storedSessionUser();
    const restored = supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (data.session) {
          sessionStore.set({
            status: 'signed-in',
            userId: data.session.user.id,
            email: data.session.user.email ?? null,
          });
          return;
        }
        const kept = error && isAuthRetryableFetchError(error) ? await storedSessionUser() : null;
        sessionStore.set(
          kept
            ? { status: 'signed-in', userId: kept.id, email: kept.email }
            : { status: 'signed-out' },
        );
      })
      .catch(() => {
        // The session storage failed (for example the browser closed the database). The stored
        // session, when it could be read, still holds; otherwise the person signs in again.
        if (sessionStore.get().status === 'loading') {
          sessionStore.set(
            stored
              ? { status: 'signed-in', userId: stored.id, email: stored.email }
              : { status: 'signed-out' },
          );
        }
      });

    const useStoredSession = () => {
      if (stored && sessionStore.get().status === 'loading') {
        sessionStore.set({ status: 'signed-in', userId: stored.id, email: stored.email });
      }
    };

    if (!stored) {
      // Without a stored session the Auth client answers without using the network.
      await restored;
    } else if (!navigator.onLine) {
      useStoredSession();
    } else {
      await Promise.race([restored, delay(SESSION_RESTORE_WAIT_MS).then(useStoredSession)]);
    }
  })();
  // A start-up that failed is tried again on the next navigation instead of failing for good.
  initialisation = starting.catch((error: unknown) => {
    initialisation = null;
    throw error;
  });
  return initialisation;
}

/**
 * Removes the stored session without the Auth service, for when signing out normally is not
 * possible (for example offline with an expired access token). On a shared device, signing out must
 * always take effect.
 */
export async function forgetStoredSession(): Promise<void> {
  await Promise.all(
    ['', '-user', '-code-verifier'].map((suffix) =>
      authStorage.removeItem(`${SESSION_STORAGE_KEY}${suffix}`).catch(() => undefined),
    ),
  );
  sessionStore.set({ status: 'signed-out' });
}

export function currentUserId(): string | null {
  const state = sessionStore.get();
  return state.status === 'signed-in' ? state.userId : null;
}
