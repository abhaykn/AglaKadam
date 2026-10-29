import { z } from 'zod';
import { registerChange } from '@/features/offline/change-registry';
import type { AppSupabaseClient } from '@/lib/supabase';
import { EXAM_KINDS, examName } from './exam-change';

/**
 * Sharing an exam's result for a class with the families of its children. Until it is shared,
 * families see none of its marks; it can be taken back. Kept on the phone like the marks.
 */

export const resultShareKey = (examId: string, classSectionId: string) =>
  ['result-share', examId, classSectionId] as const;
export const resultShareDedupeKey = (examId: string, classSectionId: string) =>
  `result-share:${examId}:${classSectionId}`;

export interface ResultShare {
  sharedAt: string;
}

const shareSchema = z.object({
  examId: z.guid(),
  classSectionId: z.guid(),
  schoolId: z.guid(),
  shared: z.boolean(),
  kind: z.enum(EXAM_KINDS),
  title: z.string().max(80),
});

export type ResultShareChange = z.infer<typeof shareSchema>;

export async function sendResultShare(
  change: ResultShareChange,
  supabase: AppSupabaseClient,
): Promise<void> {
  if (change.shared) {
    // Who shared it and when are recorded by the database; sharing again changes nothing.
    const { error } = await supabase.from('exam_result_shares').upsert(
      {
        exam_id: change.examId,
        class_section_id: change.classSectionId,
        school_id: change.schoolId,
      },
      { onConflict: 'exam_id,class_section_id', ignoreDuplicates: true },
    );
    if (error) {
      throw error;
    }
    return;
  }
  const { error } = await supabase
    .from('exam_result_shares')
    .delete()
    .eq('exam_id', change.examId)
    .eq('class_section_id', change.classSectionId);
  if (error) {
    throw error;
  }
}

export const resultShareChange = registerChange<ResultShareChange>({
  kind: 'exam.share',
  schema: shareSchema,
  send: async (change, context) => {
    await sendResultShare(change, context.supabase);
    return null;
  },
  invalidates: (change) => [resultShareKey(change.examId, change.classSectionId)],
  describe: (change, t) =>
    t(change.shared ? 'exams.change.share' : 'exams.change.unshare', {
      exam: examName(change, t),
    }),
});
