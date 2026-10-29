import { authStorage, SESSION_STORAGE_KEY } from '@/lib/session-storage';
import { createClientForToken, createWorkerSupabase } from '@/lib/supabase';
import './changes';
import { DeviceStore } from './device-store';
import { sendDueChanges } from './outbox-sync';
import { SYNC_LOCK, WORKER_LOCK_WAIT_MS } from './sync-constants';

/**
 * Sending waiting changes from the service worker, after the application has been closed. It uses
 * the same rules as the pages (see `outbox-sync.ts`), the same session and the same device store,
 * and only ever sends what the application saved: it never creates a key or an account's data.
 */

/** The account of the session kept on this device, if anyone is signed in. */
async function signedInUserId(): Promise<string | null> {
  try {
    const raw = await authStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } };
    return typeof parsed.user?.id === 'string' ? parsed.user.id : null;
  } catch {
    return null;
  }
}

/** The connection was lost, or a page kept sending for too long; the browser tries again later. */
export class SendInterruptedError extends Error {
  constructor() {
    super('Waiting changes could not all be sent; the browser will try again.');
    this.name = 'SendInterruptedError';
  }
}

async function sendForAccount(userId: string): Promise<void> {
  // The session, refreshed if needed. Requests are then made with this account's token alone, so a
  // sign-in by someone else during the run can never lend this account's changes another identity.
  const { data } = await createWorkerSupabase().auth.getSession();
  const session = data.session;
  if (session?.user.id !== userId) {
    return;
  }
  const store = await DeviceStore.open();
  try {
    const key = await store.existingKeyFor(userId);
    if (!key) {
      return;
    }
    const result = await sendDueChanges({
      store,
      key,
      userId,
      supabase: createClientForToken(session.access_token),
      hasSession: () => Promise.resolve(true),
      // The browser wakes the worker because a network has just become available.
      forced: true,
      isOnline: () => navigator.onLine,
      // Stops as soon as the account signs out on this device.
      shouldContinue: async () => (await signedInUserId()) === userId,
    });
    if (result.stoppedForNetwork) {
      throw new SendInterruptedError();
    }
  } finally {
    store.close();
  }
}

/**
 * Sends the signed-in account's waiting changes. Resolves when there is nothing more to do now;
 * throws when the connection was lost or a page kept the changes busy, so that the browser tries
 * again later.
 */
export async function sendFromWorker(): Promise<void> {
  const userId = await signedInUserId();
  if (!userId) {
    return;
  }
  const locks = 'locks' in navigator ? navigator.locks : undefined;
  if (!locks) {
    await sendForAccount(userId);
    return;
  }
  // A page that is sending holds the lock. Waiting for it, rather than giving up, means the worker
  // takes over if the page is closed half-way through.
  try {
    await locks.request(SYNC_LOCK, { signal: AbortSignal.timeout(WORKER_LOCK_WAIT_MS) }, () =>
      sendForAccount(userId),
    );
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new SendInterruptedError();
    }
    throw error;
  }
}
