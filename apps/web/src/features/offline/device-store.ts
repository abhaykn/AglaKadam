import { createDeviceKey, type SealedValue } from './cipher';
import { deleteDatabase, inTransaction, openDatabase, requestResult } from '@/lib/idb';

/**
 * The application's database on the device (IndexedDB), shared by every person who signs in on it
 * but partitioned by account: each record carries its owner's id and is encrypted with that
 * owner's key, so one person's work is never readable by another.
 *
 * Stores:
 * - `keys`: one non-extractable AES-GCM key per account.
 * - `outbox`: changes made on the device that are waiting to be sent to the server.
 * - `snapshots`: the last data each account loaded (lists, classes, rosters), so the application
 *   opens and works without a network.
 * - `blobs`: recordings and other files waiting to be uploaded, encrypted like everything else and
 *   removed once uploaded.
 */

export const DEVICE_DATABASE = 'agla-kadam';
const VERSION = 2;

export interface StoredKey {
  userId: string;
  key: CryptoKey;
  createdAt: number;
  lastUsedAt: number;
}

export type OutboxState = 'pending' | 'failed';

export interface OutboxError {
  code: string;
  message: string;
}

export interface OutboxEntry {
  id: string;
  userId: string;
  kind: string;
  /** Changes with the same key replace each other while waiting (for example one class and day). */
  dedupeKey: string;
  sealed: SealedValue;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextAttemptAt: number;
  state: OutboxState;
  lastError: OutboxError | null;
}

export interface StoredSnapshot {
  userId: string;
  name: string;
  sealed: SealedValue;
  savedAt: number;
}

export interface StoredBlob {
  id: string;
  userId: string;
  /** The file's bytes, encrypted. */
  sealed: SealedValue;
  mimeType: string;
  /** Size of the unencrypted file in bytes. */
  size: number;
  createdAt: number;
}

function upgrade(database: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    database.createObjectStore('keys', { keyPath: 'userId' });
    const outbox = database.createObjectStore('outbox', { keyPath: 'id' });
    outbox.createIndex('byUser', 'userId');
    outbox.createIndex('byUserAndDedupeKey', ['userId', 'dedupeKey']);
    database.createObjectStore('snapshots', { keyPath: ['userId', 'name'] });
  }
  if (oldVersion < 2) {
    const blobs = database.createObjectStore('blobs', { keyPath: 'id' });
    blobs.createIndex('byUser', 'userId');
  }
}

export class DeviceStore {
  private readonly database: IDBDatabase;

  private constructor(database: IDBDatabase) {
    this.database = database;
  }

  static async open(): Promise<DeviceStore> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('This browser cannot keep data on the device.');
    }
    return new DeviceStore(await openDatabase(DEVICE_DATABASE, VERSION, upgrade));
  }

  close(): void {
    this.database.close();
  }

  /**
   * Calls `listener` when the database is closed under the application, for example because a
   * newer version of the app upgrades it in another tab or the browser removes the site's data.
   */
  onClosed(listener: () => void): void {
    this.database.addEventListener('versionchange', listener);
    this.database.addEventListener('close', listener);
  }

  /**
   * The account's key if this device already has one. The service worker uses this: it only sends
   * what the application saved, so it never needs to create a key.
   */
  async existingKeyFor(userId: string): Promise<CryptoKey | undefined> {
    const existing = await inTransaction(this.database, 'keys', 'readonly', (transaction) =>
      requestResult<StoredKey | undefined>(transaction.objectStore('keys').get(userId)),
    );
    return existing?.key;
  }

  /** The account's key, created on first use. */
  async keyFor(userId: string): Promise<CryptoKey> {
    const existing = await inTransaction(this.database, 'keys', 'readonly', (transaction) =>
      requestResult<StoredKey | undefined>(transaction.objectStore('keys').get(userId)),
    );
    const now = Date.now();
    if (existing) {
      await inTransaction(this.database, 'keys', 'readwrite', (transaction) =>
        requestResult(transaction.objectStore('keys').put({ ...existing, lastUsedAt: now })),
      );
      return existing.key;
    }
    // Generated outside the transaction: an IndexedDB transaction ends when it waits on other work.
    const key = await createDeviceKey();
    const stored: StoredKey = { userId, key, createdAt: now, lastUsedAt: now };
    return inTransaction(this.database, 'keys', 'readwrite', async (transaction) => {
      const store = transaction.objectStore('keys');
      // Another tab may have created the key meanwhile; the first one wins.
      const raced = await requestResult<StoredKey | undefined>(store.get(userId));
      if (raced) {
        return raced.key;
      }
      await requestResult(store.add(stored));
      return key;
    });
  }

  /** Removes everything the account left on the device, its key included. */
  async forgetAccount(userId: string): Promise<void> {
    await inTransaction(
      this.database,
      ['keys', 'outbox', 'snapshots', 'blobs'],
      'readwrite',
      async (transaction) => {
        await requestResult(transaction.objectStore('keys').delete(userId));
        for (const storeName of ['outbox', 'blobs']) {
          const store = transaction.objectStore(storeName);
          const ids = await requestResult<IDBValidKey[]>(store.index('byUser').getAllKeys(userId));
          for (const id of ids) {
            await requestResult(store.delete(id));
          }
        }
        const snapshots = transaction.objectStore('snapshots');
        // Arrays sort after strings in IndexedDB keys, so this range covers every snapshot name.
        await requestResult(snapshots.delete(IDBKeyRange.bound([userId, ''], [userId, []])));
      },
    );
  }

  /**
   * Tidies up after accounts not used on this device for `maxAgeMs`. The data they kept for
   * offline use is removed. Changes they have not sent are never removed automatically, whatever
   * their age: only the person can decide to give them up, by signing out or deleting them. An
   * account with nothing left to send is forgotten completely. `except` (the account starting
   * now) is never touched, and a clock that has gone backwards is not trusted.
   */
  async forgetInactiveAccounts(
    maxAgeMs: number,
    { except, now = Date.now() }: { except?: string; now?: number } = {},
  ): Promise<string[]> {
    const keys = await inTransaction(this.database, 'keys', 'readonly', (transaction) =>
      requestResult<StoredKey[]>(transaction.objectStore('keys').getAll()),
    );
    const stale = keys
      .filter(
        (entry) =>
          entry.userId !== except && entry.lastUsedAt <= now && now - entry.lastUsedAt > maxAgeMs,
      )
      .map((entry) => entry.userId);
    const forgotten: string[] = [];
    for (const userId of stale) {
      if ((await this.outboxEntries(userId)).length > 0) {
        await this.forgetSnapshots(userId);
      } else {
        await this.forgetAccount(userId);
        forgotten.push(userId);
      }
    }
    return forgotten;
  }

  async forgetSnapshots(userId: string): Promise<void> {
    await inTransaction(this.database, 'snapshots', 'readwrite', async (transaction) => {
      // Arrays sort after strings in IndexedDB keys, so this range covers every snapshot name.
      await requestResult(
        transaction.objectStore('snapshots').delete(IDBKeyRange.bound([userId, ''], [userId, []])),
      );
    });
  }

  // -------------------------------------------------------------------------------------------
  // Outbox
  // -------------------------------------------------------------------------------------------

  putOutboxEntry(entry: OutboxEntry): Promise<void> {
    return inTransaction(this.database, 'outbox', 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore('outbox').put(entry));
    });
  }

  /**
   * Stores `entry`, replacing any waiting change of the same account with the same dedupe key, in
   * one transaction so that two quick saves can never leave both versions queued.
   */
  replaceOutboxEntry(entry: OutboxEntry): Promise<void> {
    return inTransaction(this.database, 'outbox', 'readwrite', async (transaction) => {
      const store = transaction.objectStore('outbox');
      const previous = await requestResult<IDBValidKey[]>(
        store.index('byUserAndDedupeKey').getAllKeys([entry.userId, entry.dedupeKey]),
      );
      for (const id of previous) {
        await requestResult(store.delete(id));
      }
      await requestResult(store.put(entry));
    });
  }

  outboxEntries(userId: string): Promise<OutboxEntry[]> {
    return inTransaction(this.database, 'outbox', 'readonly', async (transaction) => {
      const entries = await requestResult<OutboxEntry[]>(
        transaction.objectStore('outbox').index('byUser').getAll(userId),
      );
      return entries.sort((a, b) => a.createdAt - b.createdAt);
    });
  }

  outboxEntry(id: string): Promise<OutboxEntry | undefined> {
    return inTransaction(this.database, 'outbox', 'readonly', (transaction) =>
      requestResult<OutboxEntry | undefined>(transaction.objectStore('outbox').get(id)),
    );
  }

  outboxEntryByDedupeKey(userId: string, dedupeKey: string): Promise<OutboxEntry | undefined> {
    return inTransaction(this.database, 'outbox', 'readonly', (transaction) =>
      requestResult<OutboxEntry | undefined>(
        transaction.objectStore('outbox').index('byUserAndDedupeKey').get([userId, dedupeKey]),
      ),
    );
  }

  /**
   * Removes an entry once it has been sent, unless it was replaced meanwhile by a newer save (which
   * must still be sent): the entry is removed only if it is unchanged since `updatedAt`.
   */
  deleteSentOutboxEntry(id: string, updatedAt: number): Promise<boolean> {
    return inTransaction(this.database, 'outbox', 'readwrite', async (transaction) => {
      const store = transaction.objectStore('outbox');
      const current = await requestResult<OutboxEntry | undefined>(store.get(id));
      if (current?.updatedAt !== updatedAt) {
        return false;
      }
      await requestResult(store.delete(id));
      return true;
    });
  }

  /**
   * Changes a waiting entry, in one transaction, only if it still exists and (when
   * `expectedUpdatedAt` is given) has not been saved again meanwhile. Returns whether it changed.
   * Reading and writing separately could bring back an entry that was sent or replaced in between.
   */
  updateOutboxEntry(
    id: string,
    expectedUpdatedAt: number | null,
    changes: Partial<Omit<OutboxEntry, 'id' | 'userId' | 'dedupeKey' | 'sealed'>>,
  ): Promise<boolean> {
    return inTransaction(this.database, 'outbox', 'readwrite', async (transaction) => {
      const store = transaction.objectStore('outbox');
      const current = await requestResult<OutboxEntry | undefined>(store.get(id));
      if (!current) {
        return false;
      }
      if (expectedUpdatedAt !== null && current.updatedAt !== expectedUpdatedAt) {
        return false;
      }
      await requestResult(store.put({ ...current, ...changes }));
      return true;
    });
  }

  deleteOutboxEntry(id: string): Promise<void> {
    return inTransaction(this.database, 'outbox', 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore('outbox').delete(id));
    });
  }

  // -------------------------------------------------------------------------------------------
  // Blobs
  // -------------------------------------------------------------------------------------------

  putBlob(blob: StoredBlob): Promise<void> {
    return inTransaction(this.database, 'blobs', 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore('blobs').put(blob));
    });
  }

  blob(id: string): Promise<StoredBlob | undefined> {
    return inTransaction(this.database, 'blobs', 'readonly', (transaction) =>
      requestResult<StoredBlob | undefined>(transaction.objectStore('blobs').get(id)),
    );
  }

  deleteBlobs(ids: readonly string[]): Promise<void> {
    return inTransaction(this.database, 'blobs', 'readwrite', async (transaction) => {
      const store = transaction.objectStore('blobs');
      for (const id of ids) {
        await requestResult(store.delete(id));
      }
    });
  }

  /** Ids of the account's stored files, for tidying up files no waiting change refers to. */
  blobIds(userId: string): Promise<string[]> {
    return inTransaction(this.database, 'blobs', 'readonly', async (transaction) =>
      (
        await requestResult<IDBValidKey[]>(
          transaction.objectStore('blobs').index('byUser').getAllKeys(userId),
        )
      ).map(String),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------------------------

  putSnapshot(snapshot: StoredSnapshot): Promise<void> {
    return inTransaction(this.database, 'snapshots', 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore('snapshots').put(snapshot));
    });
  }

  snapshot(userId: string, name: string): Promise<StoredSnapshot | undefined> {
    return inTransaction(this.database, 'snapshots', 'readonly', (transaction) =>
      requestResult<StoredSnapshot | undefined>(
        transaction.objectStore('snapshots').get([userId, name]),
      ),
    );
  }
}

/** Deletes the whole device database, for every account. */
export function deleteDeviceDatabase(): Promise<void> {
  return deleteDatabase(DEVICE_DATABASE);
}
