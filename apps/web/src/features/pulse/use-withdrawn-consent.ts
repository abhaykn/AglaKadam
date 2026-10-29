import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { audioConsentChange, audioConsentQuery } from '@/features/consent/consent-api';
import { useWaitingOfClass } from '@/features/offline/use-waiting-of-class';

/**
 * Children of a class whose family has withdrawn consent for audio checks, as far as this device
 * knows: a decision still waiting on the device counts over the one last fetched. Such a child is
 * not recorded; the database replaces them once it knows of the withdrawal.
 */
export function useWithdrawnConsent(classSectionId: string): ReadonlySet<string> {
  const consent = useQuery(audioConsentQuery(classSectionId));
  const waiting = useWaitingOfClass(audioConsentChange, classSectionId);
  return useMemo(() => {
    const latest = new Map<string, boolean>();
    for (const [studentId, decision] of Object.entries(consent.data?.decisions ?? {})) {
      latest.set(studentId, decision.granted);
    }
    // Oldest first, so the last decision recorded on the device is the one kept.
    for (const entry of waiting.entries) {
      latest.set(entry.payload.studentId, entry.payload.granted);
    }
    return new Set([...latest].filter(([, granted]) => !granted).map(([studentId]) => studentId));
  }, [consent.data, waiting.entries]);
}
