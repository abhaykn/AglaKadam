import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionStore } from '@/features/auth/session';
import { forgetPreviousUser } from './forget-previous-user';

afterEach(() => {
  sessionStore.set({ status: 'loading' });
});

describe('forgetting the previous user', () => {
  it('clears what one user saw before anything is shown to the next', () => {
    sessionStore.set({ status: 'loading' });
    const queryClient = new QueryClient();
    const stop = forgetPreviousUser(queryClient);

    sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
    queryClient.setQueryData(['classes'], ['Class 2 A']);
    // The first sign-in on this page keeps what was restored for it.
    expect(queryClient.getQueryData(['classes'])).toEqual(['Class 2 A']);

    sessionStore.set({ status: 'signed-out' });
    // Cleared as the session changes, not after the next render.
    expect(queryClient.getQueryData(['classes'])).toBeUndefined();

    queryClient.setQueryData(['classes'], ['Class 3 B']);
    sessionStore.set({ status: 'signed-in', userId: 'crp-1', email: null });
    sessionStore.set({ status: 'signed-in', userId: 'teacher-2', email: null });
    expect(queryClient.getQueryData(['classes'])).toBeUndefined();
    stop();
  });

  it('keeps the data of the same user when their session is refreshed', () => {
    sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
    const queryClient = new QueryClient();
    const stop = forgetPreviousUser(queryClient);
    queryClient.setQueryData(['classes'], ['Class 2 A']);
    sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: 'sunita@example.org' });
    expect(queryClient.getQueryData(['classes'])).toEqual(['Class 2 A']);
    stop();
  });
});
