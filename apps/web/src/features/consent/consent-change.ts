import { z } from 'zod';
import { registerChange } from '@/features/offline/change-registry';
import { classLabel } from '@/features/workspaces/grade-label';
import type { AppSupabaseClient } from '@/lib/supabase';

/**
 * A guardian's decision about audio checks, recorded by the teacher from the signed form. Like
 * attendance, it is kept on the device and sent when a network is available, and it depends on
 * nothing that exists only in a page, so the service worker can send it too.
 *
 * Decisions are never edited: each one is a new record and the latest is the one in force, so a
 * family can withdraw consent at any time.
 */

/** Query key of the audio-check consent of a class's children. */
export function audioConsentKey(classSectionId: string) {
  return ['audio-consent', classSectionId] as const;
}

const audioConsentSchema = z.object({
  /** Chosen on the device, so that a resend is recognised and never recorded twice. */
  id: z.guid(),
  studentId: z.guid(),
  classSectionId: z.guid(),
  granted: z.boolean(),
  guardianName: z.string().trim().min(1).max(120),
  method: z.enum(['paper_form', 'in_person']),
  /**
   * When the teacher recorded it, so that the latest decision is the one in force whatever order
   * phones send them in. Missing on decisions kept by an earlier version, which the server dates
   * when it receives them.
   */
  decidedAt: z.iso.datetime({ offset: true }).optional(),
  childName: z.string().max(120),
  classLabel: z.object({ grade: z.number().int(), section: z.string() }),
});

export type AudioConsentChange = z.infer<typeof audioConsentSchema>;

export async function sendAudioConsent(
  change: AudioConsentChange,
  supabase: AppSupabaseClient,
): Promise<void> {
  const { error } = await supabase.from('guardian_consents').upsert(
    {
      id: change.id,
      student_id: change.studentId,
      purpose: 'audio_assessment',
      granted: change.granted,
      guardian_name: change.guardianName.trim(),
      method: change.method,
      ...(change.decidedAt ? { recorded_at: change.decidedAt } : {}),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) {
    throw error;
  }
}

export const audioConsentChange = registerChange<AudioConsentChange>({
  kind: 'consent.audio',
  schema: audioConsentSchema,
  send: (change, context) => sendAudioConsent(change, context.supabase),
  invalidates: (change) => [audioConsentKey(change.classSectionId)],
  describe: (change, t) =>
    t('consent.changeDescription', {
      name: change.childName,
      class: classLabel(t, change.classLabel.grade, change.classLabel.section),
    }),
});

export function audioConsentDedupeKey(id: string): string {
  return `consent-audio:${id}`;
}
