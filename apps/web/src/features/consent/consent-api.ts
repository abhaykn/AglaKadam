import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { getSupabase } from '@/lib/supabase';
import {
  audioConsentChange,
  audioConsentDedupeKey,
  audioConsentKey,
  sendAudioConsent,
  type AudioConsentChange,
} from './consent-change';

export { audioConsentChange, type AudioConsentChange } from './consent-change';

export interface ConsentDecision {
  granted: boolean;
  guardianName: string;
  method: string;
  recordedAt: string;
}

export interface ClassConsent {
  /** The decision in force for each child: the most recent one recorded. */
  decisions: Record<string, ConsentDecision>;
  /** Guardian names from the class list, to fill in the form. */
  guardianNames: Record<string, string>;
}

/**
 * The audio-check consent of everyone enrolled in a class, and the guardians' names on record.
 * Kept on the device, so decisions can be recorded in school without a network.
 */
export function audioConsentQuery(classSectionId: string) {
  return queryOptions({
    queryKey: audioConsentKey(classSectionId),
    meta: { persist: true },
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ClassConsent> => {
      const supabase = getSupabase();
      const [consents, contacts] = await Promise.all([
        supabase
          .from('guardian_consents')
          .select(
            'student_id, granted, guardian_name, method, recorded_at, students!inner(enrolments!inner(class_section_id))',
          )
          .eq('purpose', 'audio_assessment')
          .eq('students.enrolments.class_section_id', classSectionId)
          .order('recorded_at', { ascending: false })
          .order('id'),
        supabase
          .from('student_contacts')
          .select('student_id, guardian_name, students!inner(enrolments!inner(class_section_id))')
          .eq('students.enrolments.class_section_id', classSectionId),
      ]);
      if (consents.error) {
        throw consents.error;
      }
      if (contacts.error) {
        throw contacts.error;
      }
      const decisions: Record<string, ConsentDecision> = {};
      // Newest first, so the first decision seen for a child is the one in force.
      for (const row of consents.data) {
        decisions[row.student_id] ??= {
          granted: row.granted,
          guardianName: row.guardian_name,
          method: row.method,
          recordedAt: row.recorded_at,
        };
      }
      const guardianNames = Object.fromEntries(
        contacts.data.map((row) => [row.student_id, row.guardian_name]),
      );
      return { decisions, guardianNames };
    },
  });
}

/**
 * Records a guardian's decision. It is kept on the device and sent in the background; when the
 * device cannot keep it, it is sent directly, which needs a connection.
 */
export async function recordAudioConsent(
  change: AudioConsentChange,
  queryClient: QueryClient,
): Promise<{ queued: boolean }> {
  if (offlineRuntime.isAvailable) {
    try {
      await offlineRuntime.enqueue(
        audioConsentChange.kind,
        change,
        audioConsentDedupeKey(change.id),
      );
      return { queued: true };
    } catch (error) {
      if (!navigator.onLine) {
        throw error;
      }
    }
  }
  try {
    await sendAudioConsent(change, getSupabase());
    return { queued: false };
  } finally {
    void queryClient.invalidateQueries({ queryKey: audioConsentKey(change.classSectionId) });
  }
}
