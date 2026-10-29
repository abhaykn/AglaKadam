import type { QueryClient } from '@tanstack/react-query';
import { sessionStore } from '@/features/auth/session';
import { createClientForToken, getSupabase } from '@/lib/supabase';
import { onFlushRequest, requestBackgroundSync } from './background-sync';
import { changeHandler } from './change-registry';
import { openJson, sealBytes, sealJson } from './cipher';
import { DeviceStore, type OutboxEntry, type OutboxError } from './device-store';
import { blobContext, outboxContext, readStoredFile, sendDueChanges } from './outbox-sync';
import { persistQueries, restoreQueries, type QueryPersistence } from './query-snapshot';
import { SYNC_LOCK } from './sync-constants';
import { initialSyncStatus, syncStatusStore } from './sync-status';

/**
 * The offline engine of the signed-in person.
 *
 * Changes are written to an encrypted outbox on the device first and sent from there, so nothing
 * typed in a classroom waits for, or is lost to, a missing network. Sending happens automatically
 * whenever the application is open and online: on start, when the network returns, when the page
 * becomes visible again, after the session is refreshed, and on a timer while anything waits.
 * Where the browser supports Background Sync, the service worker also sends them after the
 * application has been closed (see `background-sync.ts`). Changes are sent oldest first; one that
 * keeps failing never holds up the others.
 */

/** After this long unused on a device, an account's offline copies of data are removed. */
const INACTIVE_ACCOUNT_MS = 45 * 24 * 60 * 60 * 1000;
/** While changes wait and the device is online, sending is tried at least this often. */
const IDLE_CHECK_MS = 60_000;
/** The shortest wait between automatic attempts, so a busy tab never spins. */
const SHORTEST_WAIT_MS = 5_000;
/** Without a usable session, sending pauses this long (or until the session is refreshed). */
const SESSION_WAIT_MS = 30_000;
/** Stored files no waiting change refers to are removed once they are this old. */
const ORPHAN_FILE_AGE_MS = 24 * 60 * 60 * 1000;

export interface WaitingChange {
  id: string;
  kind: string;
  description: string | null;
  payload: unknown;
  createdAt: number;
  attempts: number;
  state: OutboxEntry['state'];
  lastError: OutboxError | null;
  nextAttemptAt: number;
}

export interface WaitingEntry {
  id: string;
  payload: unknown;
  state: OutboxEntry['state'];
  error: OutboxError | null;
}

interface ActiveAccount {
  userId: string;
  store: DeviceStore;
  key: CryptoKey;
  persistence: QueryPersistence;
}

function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Runs `work` while holding the cross-tab sync lock, or skips it when another tab is sending.
 * Returns whether it ran.
 */
async function withSyncLock(work: () => Promise<void>): Promise<boolean> {
  // Web Locks are missing in some older browsers; sending then simply is not coordinated.
  const locks = 'locks' in navigator ? navigator.locks : undefined;
  if (!locks) {
    await work();
    return true;
  }
  return locks.request(SYNC_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      return false;
    }
    await work();
    return true;
  });
}

class OfflineRuntime {
  private account: ActiveAccount | null = null;
  private starting: Promise<void> | null = null;
  private startingFor: string | null = null;
  private queryClient: QueryClient | null = null;
  /** The account whose data was last put into the query cache. */
  private cacheOwner: string | null = null;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private forceNext = false;
  /** Latest creation time handed out, so changes made within one millisecond keep their order. */
  private lastCreatedAt = 0;
  private sessionWaitUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private detach: (() => void) | null = null;

  /**
   * Opens the device store for `userId`, restores the data saved on this device and starts
   * sending waiting changes. Calling it again for the same account does nothing.
   */
  start(userId: string, queryClient: QueryClient): Promise<void> {
    if (this.account?.userId === userId) {
      return Promise.resolve();
    }
    if (this.starting && this.startingFor === userId) {
      return this.starting;
    }
    this.startingFor = userId;
    this.starting = this.open(userId, queryClient).finally(() => {
      this.starting = null;
      this.startingFor = null;
    });
    return this.starting;
  }

  private async open(userId: string, queryClient: QueryClient): Promise<void> {
    this.stop();
    this.queryClient = queryClient;
    // Whatever another account left in the cache must never be seen or saved by this one.
    if (this.cacheOwner !== null && this.cacheOwner !== userId) {
      queryClient.clear();
    }
    this.cacheOwner = userId;

    let store: DeviceStore;
    let key: CryptoKey;
    try {
      store = await DeviceStore.open();
      key = await store.keyFor(userId);
      await store.forgetInactiveAccounts(INACTIVE_ACCOUNT_MS, { except: userId });
    } catch (error) {
      syncStatusStore.set({
        ...initialSyncStatus,
        phase: 'unavailable',
        problem: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return;
    }
    if (this.currentUserId() !== userId) {
      store.close();
      return;
    }

    await restoreQueries(queryClient, store, key, userId).catch(() => false);
    if (this.currentUserId() !== userId) {
      // The session ended while the saved data was being restored: take it out again.
      queryClient.clear();
      store.close();
      return;
    }

    const persistence = persistQueries(
      queryClient,
      store,
      key,
      userId,
      () => this.currentUserId() === userId,
    );
    const account: ActiveAccount = { userId, store, key, persistence };
    this.account = account;
    store.onClosed(() => {
      if (this.account?.store === store) {
        this.stop();
        syncStatusStore.set({
          ...initialSyncStatus,
          phase: 'unavailable',
          problem: 'The browser closed the connection to the data kept on this device.',
        });
      }
    });
    this.attach();
    void this.requestDurableStorage();
    void this.removeOrphanFiles(account);
    await this.refreshStatus(true);
    void this.flush();
  }

  /** Stops sending and saving for the current account. Data on the device is kept. */
  stop(): void {
    this.detach?.();
    this.detach = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.account) {
      this.account.persistence.stop();
      this.account.store.close();
      this.account = null;
    }
    syncStatusStore.set(initialSyncStatus);
  }

  /**
   * Removes everything `userId` keeps on this device, including changes that were not sent and the
   * encryption key. Used when the person signs out on purpose; works even if the engine never
   * started (for example after the device store failed to open earlier).
   */
  async forgetAccount(userId: string): Promise<void> {
    if (this.account?.userId === userId) {
      this.stop();
    }
    const store = await DeviceStore.open();
    try {
      await store.forgetAccount(userId);
    } finally {
      store.close();
    }
  }

  private currentUserId(): string | null {
    const session = sessionStore.get();
    return session.status === 'signed-in' ? session.userId : null;
  }

  private attach(): void {
    const onOnline = () => void this.flush({ force: true });
    const onOffline = () => void this.refreshStatus();
    const onPageHide = () => void this.persistNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.flush();
      } else {
        void this.persistNow();
        // The application may be closed from here on; let the browser send what still waits.
        void this.refreshStatus();
      }
    };
    // The worker asks when the browser sees a network; changes waiting for a retry keep their delay.
    const stopListeningToWorker = onFlushRequest(() => void this.flush());
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribeSession = sessionStore.subscribe(() => {
      if (!this.account) {
        return;
      }
      if (this.currentUserId() === this.account.userId) {
        // A refreshed session can send what waited for one.
        this.sessionWaitUntil = 0;
        void this.flush();
      } else {
        this.stop();
      }
    });
    this.detach = () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
      stopListeningToWorker();
      unsubscribeSession();
    };
  }

  private async requestDurableStorage(): Promise<void> {
    // Asks the browser not to clear this site's data when space runs low. Browsers decide for
    // themselves (installed and frequently used apps are usually granted); a refusal only means
    // the usual rules apply.
    try {
      if ('storage' in navigator && !(await navigator.storage.persisted())) {
        await navigator.storage.persist();
      }
    } catch {
      // Not supported; nothing to do.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Changes
  // -------------------------------------------------------------------------------------------

  /** Saves the data kept for offline use now, for example before the page closes. */
  async persistNow(): Promise<void> {
    await this.account?.persistence.flush().catch(() => undefined);
  }

  /** Whether changes can be kept on this device. */
  get isAvailable(): boolean {
    return this.account !== null;
  }

  /**
   * Keeps a change on the device and sends it as soon as possible. A waiting change with the same
   * `dedupeKey` is replaced, so only the latest version of, for example, one day's attendance is
   * sent. Throws when the device cannot keep it; callers then send directly.
   */
  async enqueue(kind: string, payload: unknown, dedupeKey: string): Promise<void> {
    const account = this.account;
    if (!account) {
      throw new Error('Changes cannot be kept on this device.');
    }
    const handler = changeHandler(kind);
    if (!handler) {
      throw new Error(`Unknown change kind "${kind}".`);
    }
    const checked = handler.schema.parse(payload);
    const id = crypto.randomUUID();
    const now = Math.max(Date.now(), this.lastCreatedAt + 1);
    this.lastCreatedAt = now;
    const sealed = await sealJson(account.key, checked, outboxContext(account.userId, id));
    await account.store.replaceOutboxEntry({
      id,
      userId: account.userId,
      kind,
      dedupeKey,
      sealed,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      nextAttemptAt: now,
      state: 'pending',
      lastError: null,
    });
    // The change is kept from here on; a failure to recount must not make the caller think otherwise.
    await this.refreshStatus(true).catch(() => undefined);
    void this.flush({ force: true });
  }

  /**
   * Keeps a file (for example a recording) on the device, encrypted, and returns its id. The change
   * that carries it lists the id in its handler's `files`; the file is removed once that change has
   * been sent or discarded.
   */
  async storeFile(file: Blob): Promise<string> {
    const account = this.account;
    if (!account) {
      throw new Error('Files cannot be kept on this device.');
    }
    const id = crypto.randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sealed = await sealBytes(account.key, bytes, blobContext(account.userId, id));
    await account.store.putBlob({
      id,
      userId: account.userId,
      sealed,
      mimeType: file.type,
      size: bytes.byteLength,
      createdAt: Date.now(),
    });
    return id;
  }

  /** The decrypted contents of a file kept with {@link storeFile}. */
  async readFile(id: string): Promise<Blob> {
    const account = this.account;
    if (!account) {
      throw new Error('Files cannot be read on this device.');
    }
    return readStoredFile(account.store, account.key, account.userId, id);
  }

  /** Removes files kept with {@link storeFile}, for example when the change could not be saved. */
  async deleteFiles(ids: readonly string[]): Promise<void> {
    await this.account?.store.deleteBlobs(ids);
  }

  /** The waiting change with `dedupeKey`, if any, for showing unsent work. */
  async waitingEntry(dedupeKey: string): Promise<WaitingEntry | null> {
    const account = this.account;
    if (!account) {
      return null;
    }
    const entry = await account.store.outboxEntryByDedupeKey(account.userId, dedupeKey);
    if (!entry) {
      return null;
    }
    const payload = await openJson<unknown>(
      account.key,
      entry.sealed,
      outboxContext(account.userId, entry.id),
    );
    return { id: entry.id, payload, state: entry.state, error: entry.lastError };
  }

  /** Every waiting change, decrypted, oldest first. */
  async waitingChanges(
    describe: (kind: string, payload: unknown) => string | null,
  ): Promise<WaitingChange[]> {
    const account = this.account;
    if (!account) {
      return [];
    }
    const entries = await account.store.outboxEntries(account.userId);
    const changes: WaitingChange[] = [];
    for (const entry of entries) {
      let payload: unknown;
      try {
        payload = await openJson<unknown>(
          account.key,
          entry.sealed,
          outboxContext(account.userId, entry.id),
        );
      } catch {
        payload = null;
      }
      changes.push({
        id: entry.id,
        kind: entry.kind,
        description: payload === null ? null : describe(entry.kind, payload),
        payload,
        createdAt: entry.createdAt,
        attempts: entry.attempts,
        state: entry.state,
        lastError: entry.lastError,
        nextAttemptAt: entry.nextAttemptAt,
      });
    }
    return changes;
  }

  /** Sends a refused or waiting change again now. */
  async retry(id: string): Promise<void> {
    const account = this.account;
    if (!account) {
      return;
    }
    // Atomic, and only if the change still exists: a change sent meanwhile must not come back.
    await account.store.updateOutboxEntry(id, null, {
      state: 'pending',
      nextAttemptAt: Date.now(),
    });
    await this.refreshStatus(true);
    void this.flush({ force: true });
  }

  /**
   * Deletes a change without sending it, with the files it carries. Returns whether it was still
   * waiting: a change that reached the server meanwhile is not taken back.
   *
   * A change that may be on its way (not refused) is deleted only once no send is under way in any
   * tab or in the service worker, so that it is never deleted half sent, for example after its file
   * was uploaded but before the record that uses the file.
   */
  async discard(id: string): Promise<boolean> {
    const account = this.account;
    if (!account) {
      return false;
    }
    const entry = await account.store.outboxEntry(id);
    if (!entry) {
      return false;
    }
    const remove = async (): Promise<boolean> => {
      if (!(await account.store.outboxEntry(id))) {
        return false;
      }
      const files = await this.filesOf(account, id);
      await account.store.deleteOutboxEntry(id);
      if (files.length > 0) {
        await account.store.deleteBlobs(files);
      }
      return true;
    };
    const locks = 'locks' in navigator ? navigator.locks : undefined;
    const removed =
      entry.state === 'failed' || !locks ? await remove() : await locks.request(SYNC_LOCK, remove);
    await this.refreshStatus(true);
    return removed;
  }

  /** Ids of the files a waiting change carries; empty when it cannot be read. */
  private async filesOf(account: ActiveAccount, id: string): Promise<string[]> {
    const entry = await account.store.outboxEntry(id);
    const handler = entry ? changeHandler(entry.kind) : undefined;
    if (!entry || !handler?.files) {
      return [];
    }
    try {
      const payload = await openJson<unknown>(
        account.key,
        entry.sealed,
        outboxContext(account.userId, entry.id),
      );
      const parsed = handler.schema.safeParse(payload);
      return parsed.success ? handler.files(parsed.data) : [];
    } catch {
      return [];
    }
  }

  /**
   * Removes stored files that no waiting change refers to any more, for example when the page closed
   * between keeping a recording and saving the change that carries it. Recent files are left alone,
   * since their change may still be on its way into the outbox.
   */
  private async removeOrphanFiles(account: ActiveAccount): Promise<void> {
    try {
      const stored = await account.store.blobIds(account.userId);
      if (stored.length === 0) {
        return;
      }
      const referenced = new Set<string>();
      for (const entry of await account.store.outboxEntries(account.userId)) {
        for (const file of await this.filesOf(account, entry.id)) {
          referenced.add(file);
        }
      }
      const cutoff = Date.now() - ORPHAN_FILE_AGE_MS;
      const orphans: string[] = [];
      for (const id of stored) {
        if (!referenced.has(id)) {
          const blob = await account.store.blob(id);
          if (blob && blob.createdAt < cutoff) {
            orphans.push(id);
          }
        }
      }
      if (orphans.length > 0) {
        await account.store.deleteBlobs(orphans);
      }
    } catch {
      // Tidying up is tried again on the next start.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------

  /**
   * Sends every change that is due. With `force` (a person asked, or the network has just come
   * back), changes waiting for a retry are sent now as well. Concurrent calls share one run.
   */
  flush({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (force) {
      this.forceNext = true;
    }
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      let again = true;
      while (again) {
        this.flushAgain = false;
        const forced = this.forceNext;
        this.forceNext = false;
        const ran = await withSyncLock(() => this.sendDue(forced));
        if (!ran && forced) {
          // Another tab is sending; the request to send everything now still stands.
          this.forceNext = true;
        }
        again = this.consumeFlushRequest();
      }
    })()
      .catch(() => undefined)
      .then(async () => {
        this.flushing = null;
        // Part of the run, so that whoever waits for it sees the counts that result from it.
        await this.refreshStatus(true).catch(() => undefined);
      });
    return this.flushing;
  }

  /** Whether another send was asked for while one was running. */
  private consumeFlushRequest(): boolean {
    const requested = this.flushAgain;
    this.flushAgain = false;
    return requested;
  }

  private async sendDue(forced: boolean): Promise<void> {
    const account = this.account;
    if (!account) {
      return;
    }
    if (this.currentUserId() !== account.userId) {
      return;
    }
    if (!forced && Date.now() < this.sessionWaitUntil) {
      return;
    }
    const refreshed = new Set<string>();
    const refresh = (keys: readonly (readonly unknown[])[]) => {
      for (const queryKey of keys) {
        const id = JSON.stringify(queryKey);
        if (!refreshed.has(id)) {
          refreshed.add(id);
          void this.queryClient?.invalidateQueries({ queryKey });
        }
      }
    };
    // Changes are sent with the token of the account that made them, taken once the session is
    // confirmed, so that a switch of account during the run cannot send them as someone else.
    let accessToken = '';
    const result = await sendDueChanges({
      store: account.store,
      key: account.key,
      userId: account.userId,
      supabase: createClientForToken(() => accessToken),
      hasSession: async () => {
        const { data } = await getSupabase().auth.getSession();
        if (data.session?.user.id !== account.userId) {
          return false;
        }
        accessToken = data.session.access_token;
        return true;
      },
      forced,
      isOnline,
      shouldContinue: () => this.account === account && this.currentUserId() === account.userId,
      onStart: () => {
        syncStatusStore.set((status) => ({ ...status, phase: 'syncing' }));
      },
      onSent: (handler, payload, answer) => {
        if (this.queryClient) {
          handler.onSent?.(payload, answer, this.queryClient);
        }
      },
      onSettled: (handler, payload, outcome) => {
        if (outcome === 'sent') {
          syncStatusStore.set((status) => ({
            ...status,
            lastSyncedAt: Date.now(),
            revision: status.revision + 1,
          }));
        }
        refresh(handler.invalidates(payload));
      },
    });
    if (result.needsSession) {
      this.sessionWaitUntil = Date.now() + SESSION_WAIT_MS;
    }
  }

  /**
   * Recounts the waiting changes and schedules the next automatic send. `changed` tells views to
   * read the waiting changes again; it is false when only the time or the network changed.
   */
  async refreshStatus(changed = false): Promise<void> {
    const account = this.account;
    if (!account) {
      return;
    }
    const entries = await account.store.outboxEntries(account.userId);
    if (this.account !== account) {
      return;
    }
    const pending = entries.filter((entry) => entry.state === 'pending');
    const failed = entries.length - pending.length;
    const online = isOnline();
    const phase: 'offline' | 'syncing' | 'idle' = !online
      ? 'offline'
      : this.flushing && pending.length > 0
        ? 'syncing'
        : 'idle';
    syncStatusStore.set((status) => {
      const revision = changed ? status.revision + 1 : status.revision;
      if (
        phase === status.phase &&
        pending.length === status.pending &&
        failed === status.failed &&
        revision === status.revision
      ) {
        return status;
      }
      return {
        phase,
        pending: pending.length,
        failed,
        lastSyncedAt: status.lastSyncedAt,
        problem: null,
        revision,
      };
    });

    // While this page is visible and online it sends by itself, with its own delays between tries.
    // Offline, or once hidden (the app may be closed), the browser sends in the background.
    if (pending.length > 0 && (!online || document.visibilityState === 'hidden')) {
      void requestBackgroundSync();
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Offline nothing can be sent; the online event starts sending again.
    if (pending.length > 0 && online) {
      const next = Math.max(
        Math.min(...pending.map((entry) => entry.nextAttemptAt)),
        this.sessionWaitUntil,
      );
      const wait = Math.min(Math.max(next - Date.now(), SHORTEST_WAIT_MS), IDLE_CHECK_MS);
      this.timer = setTimeout(() => void this.flush(), wait);
    }
  }
}

export const offlineRuntime = new OfflineRuntime();
