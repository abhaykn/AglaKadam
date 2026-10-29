/**
 * A small promise layer over IndexedDB: opening a versioned database, running a transaction to
 * completion, and awaiting single requests. Used by the offline store and the session storage, in
 * pages and in the service worker.
 */

/** Resolves with the request's result, typed as the caller knows it to be (IndexedDB stores `any`). */
export function requestResult<T = unknown>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result as T));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB error')));
  });
}

export function openDatabase(
  name: string,
  version: number,
  upgrade: (database: IDBDatabase, oldVersion: number, transaction: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.addEventListener('upgradeneeded', (event) => {
      const transaction = request.transaction;
      if (transaction) {
        upgrade(request.result, event.oldVersion, transaction);
      }
    });
    request.addEventListener('success', () => {
      const database = request.result;
      // Another tab upgrading the schema asks open connections to close.
      database.addEventListener('versionchange', () => database.close());
      resolve(database);
    });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB error')));
    request.addEventListener('blocked', () =>
      reject(new Error('The offline store is open in an older tab. Close other tabs and retry.')),
    );
  });
}

/**
 * Runs `work` in a transaction and resolves with its result once the transaction has committed,
 * so that callers never act on changes that were rolled back.
 */
export function inTransaction<T>(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let result: T;
    let failed = false;
    transaction.addEventListener('complete', () => resolve(result));
    transaction.addEventListener('error', () => {
      failed = true;
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
    transaction.addEventListener('abort', () => {
      if (!failed) {
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      }
    });
    Promise.resolve(work(transaction)).then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        failed = true;
        try {
          transaction.abort();
        } catch {
          // The transaction may already have finished.
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve());
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB error')));
  });
}
