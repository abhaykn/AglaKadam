import { useEffect } from 'react';
import { isPageOutOfRange } from '@/lib/postgrest-errors';
import { PAGE_SIZE } from './admin-api';

/**
 * Moves back to the last page that still has rows when a list shrinks below the page on screen, for
 * example after the only person on the last page has been transferred. Without this the list would
 * show an empty page, or an error, with no way back.
 */
export function usePageInRange(
  page: number,
  setPage: (page: number) => void,
  result: { total: number; rows: unknown[] } | undefined,
  error: unknown,
): void {
  useEffect(() => {
    if (page === 0) {
      return;
    }
    if (isPageOutOfRange(error)) {
      setPage(page - 1);
    } else if (result?.rows.length === 0) {
      setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
    }
  }, [page, setPage, result, error]);
}
