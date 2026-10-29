import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';
import { openJson, sealJson } from './cipher';
import type { DeviceStore } from './device-store';

/**
 * Keeps the data a person needs offline: queries marked `meta: { persist: true }` (their access,
 * classes, rosters and recent attendance) are saved, encrypted, on the device after they load, and
 * put back into the query cache when the application starts. The application therefore opens with
 * the last data seen even without a network, and refreshes it when a network is available.
 */

const SNAPSHOT_NAME = 'queries';
/**
 * Version of the saved layout. Raise it whenever the shape of persisted query data changes, so an
 * updated application never reads data saved by an older one as if it were current.
 */
const SNAPSHOT_FORMAT = 1;
const SAVE_DELAY_MS = 1000;
/** Data older than this is not kept for offline use; it would mislead more than it helps. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface SavedQueries {
  format: number;
  state: DehydratedState;
}

/**
 * Each query is kept only while its own data is recent, so a class list that is never opened
 * again does not stay on the device for ever just because other data keeps being saved.
 */
function shouldKeep(query: Query, now: number): boolean {
  return (
    query.meta?.persist === true &&
    query.state.status === 'success' &&
    now - query.state.dataUpdatedAt <= SNAPSHOT_MAX_AGE_MS
  );
}

function snapshotContext(userId: string): string {
  return `${userId}|snapshots|${SNAPSHOT_NAME}`;
}

/** Puts the saved data of `userId` back into the cache. Returns whether anything was restored. */
export async function restoreQueries(
  queryClient: QueryClient,
  store: DeviceStore,
  key: CryptoKey,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  const stored = await store.snapshot(userId, SNAPSHOT_NAME);
  if (!stored || now - stored.savedAt > SNAPSHOT_MAX_AGE_MS) {
    return false;
  }
  try {
    const saved = await openJson<SavedQueries>(key, stored.sealed, snapshotContext(userId));
    if (saved.format !== SNAPSHOT_FORMAT) {
      return false;
    }
    hydrate(queryClient, {
      ...saved.state,
      queries: saved.state.queries.filter(
        (query) => now - query.state.dataUpdatedAt <= SNAPSHOT_MAX_AGE_MS,
      ),
    });
    return true;
  } catch {
    // A snapshot that cannot be read (for example from another key) is simply not used.
    return false;
  }
}

export interface QueryPersistence {
  /** Saves now, for example before the page is hidden. */
  flush: () => Promise<void>;
  stop: () => void;
}

/**
 * Saves the persisted queries shortly after any of them changes. `isCurrent` is checked before
 * every save so that nothing is written for an account that has signed out meanwhile.
 */
export function persistQueries(
  queryClient: QueryClient,
  store: DeviceStore,
  key: CryptoKey,
  userId: string,
  isCurrent: () => boolean,
): QueryPersistence {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  // Read through a function: the flag can change while a save waits for encryption.
  const isActive = () => !stopped && isCurrent();

  const save = async () => {
    timer = null;
    if (!isActive()) {
      return;
    }
    const now = Date.now();
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) => shouldKeep(query, now),
    });
    if (state.queries.length === 0) {
      // Never replace saved data with nothing, for example right after the cache was cleared.
      return;
    }
    const saved: SavedQueries = { format: SNAPSHOT_FORMAT, state };
    const sealed = await sealJson(key, saved, snapshotContext(userId));
    if (!isActive()) {
      return;
    }
    await store.putSnapshot({ userId, name: SNAPSHOT_NAME, sealed, savedAt: Date.now() });
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') {
      return;
    }
    if (event.query.meta?.persist !== true) {
      return;
    }
    timer ??= setTimeout(() => void save().catch(() => undefined), SAVE_DELAY_MS);
  });

  return {
    flush: async () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await save();
    },
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      unsubscribe();
    },
  };
}
