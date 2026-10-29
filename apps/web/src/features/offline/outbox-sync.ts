import type { AppSupabaseClient } from '@/lib/supabase';
import { changeHandler, type ChangeContext, type ChangeHandler } from './change-registry';
import { openBytes, openJson } from './cipher';
import type { DeviceStore, OutboxEntry } from './device-store';
import { ChangeRejectedError, classifyFailure, retryDelay, toError } from './sync-errors';

/**
 * Sending the changes waiting in one account's outbox. Shared by the application (while it is
 * open) and the service worker (after it has been closed), so both follow exactly the same rules.
 */

/**
 * A send that has not answered by then is treated as a lost connection and tried again later,
 * unless the kind of change allows longer (see `ChangeHandler.timeoutMs`).
 */
export const SEND_TIMEOUT_MS = 45_000;

/** Error code of a change whose recording is no longer on the device (or cannot be read). */
export const FILE_MISSING = 'file_missing';

export function outboxContext(userId: string, id: string): string {
  return `${userId}|outbox|${id}`;
}

export function blobContext(userId: string, id: string): string {
  return `${userId}|blobs|${id}`;
}

/**
 * Settles with `promise`, or fails after `milliseconds` so that a request that never answers (a
 * connection that looks online but carries nothing) cannot hold up every other change.
 */
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The server did not answer in time.'));
    }, milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(toError(error));
      },
    );
  });
}

/**
 * The decrypted contents of a stored file. A file that is gone or cannot be decrypted will never
 * come back, so the change that needs it is refused rather than retried for ever.
 */
export async function readStoredFile(
  store: DeviceStore,
  key: CryptoKey,
  userId: string,
  id: string,
): Promise<Blob> {
  const stored = await store.blob(id);
  if (stored?.userId !== userId) {
    throw new ChangeRejectedError(FILE_MISSING, 'The recording is no longer on this device.');
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await openBytes(key, stored.sealed, blobContext(userId, id));
  } catch {
    throw new ChangeRejectedError(FILE_MISSING, 'The recording on this device cannot be read.');
  }
  return new Blob([bytes], { type: stored.mimeType });
}

export interface OutboxSyncOptions {
  store: DeviceStore;
  key: CryptoKey;
  userId: string;
  supabase: AppSupabaseClient;
  /** Whether the account has a usable session to send with (refreshing it if needed). */
  hasSession: () => Promise<boolean>;
  /** Send changes waiting for a retry as well, because a person asked or the network returned. */
  forced: boolean;
  isOnline: () => boolean;
  /**
   * Whether sending should go on: the account is still the one signed in and nothing was stopped.
   * Asked again before every change.
   */
  shouldContinue: () => boolean | Promise<boolean>;
  /** Called once a session is confirmed and sending begins. */
  onStart?: () => void;
  /** Called after the server accepted a change, before it is removed from the device. */
  onSent?: (handler: ChangeHandler<unknown>, payload: unknown, answer: unknown) => void;
  /** Called after the server answered and the outbox was updated: accepted, or refused. */
  onSettled?: (
    handler: ChangeHandler<unknown>,
    payload: unknown,
    outcome: 'sent' | 'refused',
  ) => void;
  now?: () => number;
}

export interface OutboxSyncResult {
  sent: number;
  /** No usable session: nothing was sent, nothing counted as an attempt. */
  needsSession: boolean;
  /** Sending stopped because the connection was lost; some changes still wait. */
  stoppedForNetwork: boolean;
}

/** Runs a caller's hook; a failing hook must never keep a sent change on the device. */
function quietly(hook: () => void): void {
  try {
    hook();
  } catch (error) {
    console.error('A sync hook failed:', error);
  }
}

async function recordFailure(
  options: OutboxSyncOptions,
  entry: OutboxEntry,
  code: string,
  message: string,
): Promise<void> {
  // Only if the person has not saved a newer version meanwhile, which must still be sent.
  await options.store.updateOutboxEntry(entry.id, entry.updatedAt, {
    state: 'failed',
    attempts: entry.attempts + 1,
    lastError: { code, message },
  });
}

/** Sends every change of the account that is due, oldest first. */
export async function sendDueChanges(options: OutboxSyncOptions): Promise<OutboxSyncResult> {
  const { store, key, userId } = options;
  const now = options.now ?? Date.now;
  const result: OutboxSyncResult = { sent: 0, needsSession: false, stoppedForNetwork: false };
  if (!options.isOnline() || !(await options.shouldContinue())) {
    return result;
  }
  const startedAt = now();
  const due = (await store.outboxEntries(userId)).filter(
    (entry) => entry.state === 'pending' && (options.forced || entry.nextAttemptAt <= startedAt),
  );
  if (due.length === 0) {
    return result;
  }
  // Without a session the Data API would answer as an anonymous visitor and refuse every change
  // as not permitted, which would wrongly mark them as refused.
  const hasSession = await withTimeout(options.hasSession(), SEND_TIMEOUT_MS).catch(() => false);
  if (!hasSession) {
    return { ...result, needsSession: true };
  }
  options.onStart?.();
  const context: ChangeContext = {
    supabase: options.supabase,
    readFile: (id) => readStoredFile(store, key, userId, id),
  };

  for (const listed of due) {
    if (!options.isOnline() || !(await options.shouldContinue())) {
      break;
    }
    // Read again: while earlier changes were sent, this one may have been deleted, refused, or saved
    // again in a newer version (which is then the one to send).
    const entry = await store.outboxEntry(listed.id);
    if (entry?.userId !== userId || entry.state !== 'pending') {
      continue;
    }
    const handler = changeHandler(entry.kind);
    let payload: unknown;
    try {
      payload = await openJson<unknown>(key, entry.sealed, outboxContext(userId, entry.id));
    } catch {
      await recordFailure(options, entry, 'unreadable', 'The saved change cannot be read.');
      continue;
    }
    const parsed = handler?.schema.safeParse(payload);
    if (!handler || !parsed?.success) {
      await recordFailure(options, entry, 'unsupported', 'This change cannot be sent.');
      continue;
    }

    let answer: unknown;
    try {
      answer = await withTimeout(
        handler.send(parsed.data, context),
        handler.timeoutMs ?? SEND_TIMEOUT_MS,
      );
    } catch (error) {
      const failure = classifyFailure(error);
      if (failure.kind === 'reject') {
        await recordFailure(options, entry, failure.code, failure.message);
        // The server's data differs from what the device assumed; show the current version.
        quietly(() => options.onSettled?.(handler, parsed.data, 'refused'));
        continue;
      }
      // Token problems are not the change's fault; they do not count as an attempt.
      const attempts = failure.kind === 'retry' ? entry.attempts + 1 : entry.attempts;
      await store.updateOutboxEntry(entry.id, entry.updatedAt, {
        attempts,
        nextAttemptAt: now() + retryDelay(Math.max(1, attempts)),
        lastError: { code: failure.code, message: failure.message },
      });
      if (failure.kind === 'reauthenticate') {
        return { ...result, needsSession: true };
      }
      if (failure.code === 'network') {
        // The connection is gone; the rest would fail the same way.
        return { ...result, stoppedForNetwork: true };
      }
      continue;
    }

    quietly(() => options.onSent?.(handler, parsed.data, answer));
    if (await store.deleteSentOutboxEntry(entry.id, entry.updatedAt)) {
      const files = handler.files?.(parsed.data) ?? [];
      if (files.length > 0) {
        await store.deleteBlobs(files);
      }
    }
    result.sent += 1;
    quietly(() => options.onSettled?.(handler, parsed.data, 'sent'));
  }
  return result;
}
