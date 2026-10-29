import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { crpTasksQuery, useSaveTask } from './visit-api';

const toastError = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
// As in a private window without a network: nothing can be kept on the phone, nor sent.
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const TASK = {
  id: '5b6c7d8e-9f00-4112-8334-455667788990',
  clusterId: '3c4d5e6f-7081-4293-a4b5-c6d7e8f9a0b1',
  schoolId: null,
  title: 'Collect the reading cards',
  details: '',
  source: 'own' as const,
  dueOn: '2026-10-30',
  done: false,
  doneAt: null,
  removed: false,
};

describe('a save that can be neither kept nor sent', () => {
  it('puts back what the screen showed and says so', async () => {
    const queryClient = new QueryClient();
    const existing = [{ ...TASK, title: 'Earlier title', createdAt: '2026-10-20T05:00:00.000Z' }];
    queryClient.setQueryData(crpTasksQuery().queryKey, existing);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const save = renderHook(() => useSaveTask(), { wrapper }).result.current;

    expect(await save(TASK)).toBe(false);
    expect(queryClient.getQueryData(crpTasksQuery().queryKey)).toEqual(existing);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
