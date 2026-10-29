import { inTransaction, openDatabase, requestResult } from './idb';

/**
 * Where the signed-in session is kept: in IndexedDB rather than `localStorage`, because the service
 * worker can read IndexedDB too. That lets it send changes waiting on the device after the
 * application has been closed (Background Sync), with the same session the pages use: a token the
 * worker refreshes is the one the pages find next, and the other way round.
 *
 * Sessions kept in `localStorage` by earlier versions move here when the storage is first opened. When
 * IndexedDB cannot be opened (some private windows), `localStorage` is used as before; the
 * application then simply sends waiting changes only while it is open.
 */

/** Storage key of the signed-in session; the Auth client adds suffixes for related entries. */
export const SESSION_STORAGE_KEY = 'ak.session';

const DATABASE = 'agla-kadam-session';
const VERSION = 1;
const STORE = 'items';

interface Backend {
  /** IndexedDB, or `localStorage` where IndexedDB is unavailable. */
  kind: 'database' | 'local';
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

interface LegacyStorage {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** `localStorage` where it exists and may be used; never in the service worker. */
function legacyStorage(): LegacyStorage | null {
  try {
    const storage = (globalThis as { localStorage?: LegacyStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function localBackend(): Backend {
  return {
    kind: 'local',
    get: (key) => {
      try {
        return Promise.resolve(legacyStorage()?.getItem(key) ?? null);
      } catch {
        return Promise.resolve(null);
      }
    },
    set: (key, value) => {
      try {
        legacyStorage()?.setItem(key, value);
      } catch {
        // Storage is full or blocked; the session then lasts for this page only.
      }
      return Promise.resolve();
    },
    remove: (key) => {
      try {
        legacyStorage()?.removeItem(key);
      } catch {
        // Nothing is stored when storage is unavailable.
      }
      return Promise.resolve();
    },
  };
}

function databaseBackend(database: IDBDatabase): Backend {
  return {
    kind: 'database',
    get: (key) =>
      inTransaction(database, STORE, 'readonly', async (transaction) => {
        const value = await requestResult(transaction.objectStore(STORE).get(key));
        return typeof value === 'string' ? value : null;
      }),
    set: (key, value) =>
      inTransaction(database, STORE, 'readwrite', async (transaction) => {
        await requestResult(transaction.objectStore(STORE).put(value, key));
      }),
    remove: (key) =>
      inTransaction(database, STORE, 'readwrite', async (transaction) => {
        await requestResult(transaction.objectStore(STORE).delete(key));
      }),
  };
}

/**
 * Moves the session entries an earlier version kept in `localStorage` into IndexedDB. Runs once,
 * before the database is used, so that no reader can see the entry in neither place.
 */
async function moveLegacyEntries(store: Backend): Promise<void> {
  const legacy = legacyStorage();
  if (!legacy) {
    return;
  }
  try {
    const keys: string[] = [];
    for (let index = 0; index < legacy.length; index += 1) {
      const key = legacy.key(index);
      if (key?.startsWith(SESSION_STORAGE_KEY)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      const value = legacy.getItem(key);
      if (value !== null && (await store.get(key)) === null) {
        await store.set(key, value);
      }
      legacy.removeItem(key);
    }
  } catch {
    // Left in place; the person may need to sign in again, nothing else is affected.
  }
}

let backend: Promise<Backend> | null = null;

function currentBackend(): Promise<Backend> {
  backend ??= (async () => {
    if (typeof indexedDB === 'undefined') {
      return localBackend();
    }
    try {
      const database = await openDatabase(DATABASE, VERSION, (created) => {
        created.createObjectStore(STORE);
      });
      // Reopened on next use if the browser closes it (site data cleared, or a newer version).
      const reset = () => {
        backend = null;
      };
      database.addEventListener('versionchange', () => {
        database.close();
        reset();
      });
      database.addEventListener('close', reset);
      const store = databaseBackend(database);
      await moveLegacyEntries(store);
      return store;
    } catch {
      return localBackend();
    }
  })();
  return backend;
}

/** Runs a storage operation; after a failure the database is opened afresh on next use. */
async function attempt<T>(operation: (store: Backend) => Promise<T>): Promise<T> {
  try {
    return await operation(await currentBackend());
  } catch (error) {
    backend = null;
    throw error;
  }
}

/** Storage for the Auth client (`auth.storage`), shared by the pages and the service worker. */
export const authStorage = {
  getItem(key: string): Promise<string | null> {
    return attempt((store) => store.get(key));
  },
  setItem(key: string, value: string): Promise<void> {
    return attempt((store) => store.set(key, value));
  },
  async removeItem(key: string): Promise<void> {
    await attempt((store) => store.remove(key));
    // Also any copy an earlier version left, so that a removed session never comes back.
    try {
      legacyStorage()?.removeItem(key);
    } catch {
      // Nothing is stored when storage is unavailable.
    }
  },
};
