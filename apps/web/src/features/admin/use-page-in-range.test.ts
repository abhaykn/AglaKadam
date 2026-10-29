import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePageInRange } from './use-page-in-range';

describe('usePageInRange', () => {
  it('moves back to the last page with rows when the list shrinks', () => {
    const setPage = vi.fn();
    renderHook(() => usePageInRange(2, setPage, { total: 60, rows: [] }, null));
    expect(setPage).toHaveBeenCalledWith(1);
  });

  it('steps back when the page starts beyond the end of the list', () => {
    const setPage = vi.fn();
    renderHook(() => usePageInRange(3, setPage, undefined, { code: 'PGRST103' }));
    expect(setPage).toHaveBeenCalledWith(2);
  });

  it('leaves a page with rows, the first page and other errors alone', () => {
    const setPage = vi.fn();
    renderHook(() => usePageInRange(1, setPage, { total: 60, rows: [{}] }, null));
    renderHook(() => usePageInRange(0, setPage, { total: 0, rows: [] }, null));
    renderHook(() => usePageInRange(1, setPage, undefined, new Error('offline')));
    expect(setPage).not.toHaveBeenCalled();
  });
});
