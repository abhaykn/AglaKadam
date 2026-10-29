import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import type { OutboxError, OutboxState } from './device-store';
import { offlineRuntime } from './offline-runtime';
import { syncStatusStore } from './sync-status';

export interface WaitingChangeState {
  /** False until the device has been checked; screens should wait before showing a value. */
  isLoaded: boolean;
  id: string | null;
  payload: unknown;
  state: OutboxState | null;
  error: OutboxError | null;
}

const NOTHING_WAITING: Omit<WaitingChangeState, 'isLoaded'> = {
  id: null,
  payload: null,
  state: null,
  error: null,
};

/** The change waiting on the device under `dedupeKey`, kept current as changes are saved and sent. */
export function useWaitingChange(dedupeKey: string): WaitingChangeState {
  const revision = useStore(syncStatusStore, (status) => status.revision);
  const [value, setValue] = useState<WaitingChangeState & { key: string }>({
    key: dedupeKey,
    isLoaded: false,
    ...NOTHING_WAITING,
  });

  useEffect(() => {
    let active = true;
    offlineRuntime
      .waitingEntry(dedupeKey)
      .then((entry) => {
        if (active) {
          setValue({ key: dedupeKey, isLoaded: true, ...NOTHING_WAITING, ...entry });
        }
      })
      .catch(() => {
        if (active) {
          setValue({ key: dedupeKey, isLoaded: true, ...NOTHING_WAITING });
        }
      });
    return () => {
      active = false;
    };
  }, [dedupeKey, revision]);

  // A value read for another key (the date just changed) is not shown.
  return value.key === dedupeKey ? value : { isLoaded: false, ...NOTHING_WAITING };
}
