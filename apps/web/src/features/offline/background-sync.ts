import { FLUSH_MESSAGE, OUTBOX_SYNC_TAG, SYNC_LOCK } from './sync-constants';

/**
 * Background Sync: the browser wakes the service worker once a network is available, so that
 * changes saved on the device are sent even after the application has been closed. Chromium
 * browsers (Android Chrome among them) support it; elsewhere sending resumes the next time the
 * application is opened, as before.
 */

interface SyncManagerLike {
  register: (tag: string) => Promise<void>;
}

/** Asks the browser to send waiting changes in the background once a network is available. */
export async function requestBackgroundSync(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const sync = (registration as { sync?: SyncManagerLike } | undefined)?.sync;
    await sync?.register(OUTBOX_SYNC_TAG);
  } catch {
    // Unsupported, or turned off in the site settings: sending resumes when the app is opened.
  }
}

/** Calls `listener` whenever the service worker asks this window to send waiting changes. */
export function onFlushRequest(listener: () => void): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => undefined;
  }
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'type' in data &&
      data.type === FLUSH_MESSAGE
    ) {
      listener();
    }
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}

/**
 * Runs `work` while nothing is being sent, waiting at most `waitMs` for a send in progress (in this
 * or another tab, or in the service worker). Signing out uses it, so that no send can be under way
 * while the account's data and session are removed. After the wait, `work` runs regardless.
 */
export async function withSendingPaused<T>(work: () => Promise<T>, waitMs = 3000): Promise<T> {
  const locks = 'locks' in navigator ? navigator.locks : undefined;
  if (!locks) {
    return work();
  }
  // Set inside the lock callback, so that only a wait that timed out runs `work` without the lock.
  const progress = { started: false };
  try {
    return await locks.request(SYNC_LOCK, { signal: AbortSignal.timeout(waitMs) }, () => {
      progress.started = true;
      return work();
    });
  } catch (error) {
    if (!progress.started) {
      return work();
    }
    throw error;
  }
}
