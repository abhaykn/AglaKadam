import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { keepOrSend } from '@/features/offline/keep-or-send';
import { getSupabase } from '@/lib/supabase';
import {
  resultShareChange,
  resultShareDedupeKey,
  resultShareKey,
  sendResultShare,
  type ResultShare,
  type ResultShareChange,
} from './result-share';

/** When the result was shared with the class's families, or null while it is not. */
export function resultShareQuery(examId: string, classSectionId: string) {
  return queryOptions({
    queryKey: resultShareKey(examId, classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<ResultShare | null> => {
      const { data, error } = await getSupabase()
        .from('exam_result_shares')
        .select('shared_at')
        .eq('exam_id', examId)
        .eq('class_section_id', classSectionId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data ? { sharedAt: data.shared_at } : null;
    },
  });
}

/** Shares a result or takes it back, shown at once and sent when it can be. */
export function useShareResult() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useCallback(
    async (change: ResultShareChange): Promise<boolean> => {
      const key = resultShareKey(change.examId, change.classSectionId);
      const before = queryClient.getQueryData<ResultShare | null>(key);
      queryClient.setQueryData<ResultShare | null>(key, () =>
        change.shared ? (before ?? null) : null,
      );
      try {
        await keepOrSend(
          resultShareChange.kind,
          change,
          resultShareDedupeKey(change.examId, change.classSectionId),
          async () => {
            await sendResultShare(change, getSupabase());
            void queryClient.invalidateQueries({ queryKey: key });
          },
        );
        return true;
      } catch {
        queryClient.setQueryData<ResultShare | null>(key, () => before ?? null);
        toast.error(t('exams.saveFailed'));
        return false;
      }
    },
    [queryClient, t],
  );
}
