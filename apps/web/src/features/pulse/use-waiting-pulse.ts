import { useEffect, useState } from 'react';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { syncStatusStore } from '@/features/offline/sync-status';
import { useStore } from '@/lib/store';
import { pulseAbsenceChange, pulseCheckChange } from './pulse-change';
import type { WaitingAbsence, WaitingCheck } from './pulse-status';

interface WaitingPulse {
  /** False until the device has been checked; screens wait before showing anything as due. */
  isLoaded: boolean;
  checks: WaitingCheck[];
  absences: WaitingAbsence[];
}

const NOTHING: Omit<WaitingPulse, 'isLoaded'> = { checks: [], absences: [] };

/** Checks and absences of a class still waiting on this device, kept current as they are sent. */
export function useWaitingPulse(classSectionId: string): WaitingPulse {
  const revision = useStore(syncStatusStore, (status) => status.revision);
  const [value, setValue] = useState<WaitingPulse & { key: string }>({
    key: classSectionId,
    isLoaded: false,
    ...NOTHING,
  });

  useEffect(() => {
    let active = true;
    offlineRuntime
      .waitingChanges(() => null)
      .then((changes) => {
        const checks: WaitingCheck[] = [];
        const absences: WaitingAbsence[] = [];
        for (const change of changes) {
          if (change.kind === pulseCheckChange.kind) {
            const parsed = pulseCheckChange.schema.safeParse(change.payload);
            if (parsed.success && parsed.data.classSectionId === classSectionId) {
              checks.push({
                outboxId: change.id,
                change: parsed.data,
                state: change.state,
                error: change.lastError,
              });
            }
          } else if (change.kind === pulseAbsenceChange.kind) {
            const parsed = pulseAbsenceChange.schema.safeParse(change.payload);
            if (parsed.success && parsed.data.classSectionId === classSectionId) {
              absences.push({ change: parsed.data, state: change.state });
            }
          }
        }
        if (active) {
          setValue({ key: classSectionId, isLoaded: true, checks, absences });
        }
      })
      .catch(() => {
        if (active) {
          setValue({ key: classSectionId, isLoaded: true, ...NOTHING });
        }
      });
    return () => {
      active = false;
    };
  }, [classSectionId, revision]);

  return value.key === classSectionId ? value : { isLoaded: false, ...NOTHING };
}
