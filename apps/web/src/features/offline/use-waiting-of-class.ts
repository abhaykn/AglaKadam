import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import type { ChangeHandler } from './change-registry';
import type { OutboxError, OutboxState } from './device-store';
import { offlineRuntime } from './offline-runtime';
import { syncStatusStore } from './sync-status';

export interface WaitingOf<Payload> {
  outboxId: string;
  payload: Payload;
  state: OutboxState;
  error: OutboxError | null;
}

interface WaitingOfClass<Payload> {
  /** False until the device has been checked. */
  isLoaded: boolean;
  entries: WaitingOf<Payload>[];
}

/**
 * Changes of one kind that wait on this device for a class, kept current as they are saved and
 * sent. The kind's payload names the class it belongs to.
 */
export function useWaitingOfClass<Payload extends { classSectionId: string }>(
  handler: ChangeHandler<Payload>,
  classSectionId: string,
): WaitingOfClass<Payload> {
  const revision = useStore(syncStatusStore, (status) => status.revision);
  const [value, setValue] = useState<WaitingOfClass<Payload> & { key: string }>({
    key: classSectionId,
    isLoaded: false,
    entries: [],
  });

  useEffect(() => {
    let active = true;
    offlineRuntime
      .waitingChanges(() => null)
      .then((changes) => {
        const entries: WaitingOf<Payload>[] = [];
        for (const change of changes) {
          if (change.kind !== handler.kind) {
            continue;
          }
          const parsed = handler.schema.safeParse(change.payload);
          if (parsed.success && parsed.data.classSectionId === classSectionId) {
            entries.push({
              outboxId: change.id,
              payload: parsed.data,
              state: change.state,
              error: change.lastError,
            });
          }
        }
        if (active) {
          setValue({ key: classSectionId, isLoaded: true, entries });
        }
      })
      .catch(() => {
        if (active) {
          setValue({ key: classSectionId, isLoaded: true, entries: [] });
        }
      });
    return () => {
      active = false;
    };
  }, [handler, classSectionId, revision]);

  return value.key === classSectionId ? value : { isLoaded: false, entries: [] };
}
