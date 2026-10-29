import { QueryClient } from '@tanstack/react-query';
import { rememberExamQueries } from '@/features/exams/exam-change';
import { rememberDraftQueries } from '@/features/visits/visit-change';
import { isPageOutOfRange } from '@/lib/postgrest-errors';

const THIRTY_SECONDS = 30 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/**
 * Query defaults tuned for intermittent rural connectivity: cached data is shown immediately,
 * requests pause while offline instead of failing, and focus changes do not trigger refetches.
 */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        staleTime: THIRTY_SECONDS,
        gcTime: TWENTY_FOUR_HOURS,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (isPageOutOfRange(error)) {
            return false;
          }
          if (error instanceof Error && 'status' in error) {
            const status = Number(error.status);
            if (status >= 400 && status < 500) {
              return false;
            }
          }
          return failureCount < 3;
        },
      },
      mutations: {
        networkMode: 'offlineFirst',
      },
    },
  });
  // Working copies of visits, and marks typed or saved on the phone, restored from the device at
  // start-up must keep their settings, or the next snapshot would drop them before they are sent.
  rememberDraftQueries(client);
  rememberExamQueries(client);
  return client;
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** Keep the result on the device (encrypted) so it is available offline. */
      persist?: boolean;
    };
  }
}
