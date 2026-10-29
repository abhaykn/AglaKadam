import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStorage } from '@/lib/session-storage';
import { SESSION_STORAGE_KEY } from '@/lib/supabase';
import type * as SupabaseModule from '@/lib/supabase';
import { sessionStore } from './session';
import { signOut } from './sign-in';

const authSignOut = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof SupabaseModule>()),
  getSupabase: () => ({ auth: { signOut: authSignOut } }),
}));

const SESSION = JSON.stringify({ user: { id: 'user-1' } });

async function storeSession(): Promise<void> {
  await authStorage.setItem(SESSION_STORAGE_KEY, SESSION);
  await authStorage.setItem(`${SESSION_STORAGE_KEY}-user`, SESSION);
  sessionStore.set({ status: 'signed-in', userId: 'user-1', email: null });
}

describe('signing out', () => {
  beforeEach(async () => {
    authSignOut.mockReset();
    await storeSession();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await authStorage.removeItem(SESSION_STORAGE_KEY);
    await authStorage.removeItem(`${SESSION_STORAGE_KEY}-user`);
  });

  it('removes the session when the Auth client cannot load it (offline with an expired token)', async () => {
    authSignOut.mockResolvedValue({ error: new Error('Failed to fetch') });
    await signOut();
    expect(await authStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(await authStorage.getItem(`${SESSION_STORAGE_KEY}-user`)).toBeNull();
    expect(sessionStore.get()).toEqual({ status: 'signed-out' });
  });

  it('does not wait for a token refresh that keeps the Auth client busy', async () => {
    // Only the clock is faked: the device storage schedules its own work and must keep running.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish: (value: { error: Error | null }) => void = () => undefined;
    authSignOut.mockReturnValue(
      new Promise<{ error: Error | null }>((resolve) => {
        finish = resolve;
      }),
    );
    const done = signOut();
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(sessionStore.get()).toEqual({ status: 'signed-out' });

    // A refresh that completes afterwards must not leave the person signed in.
    await authStorage.setItem(SESSION_STORAGE_KEY, SESSION);
    finish({ error: new Error('Failed to fetch') });
    await vi.runAllTimersAsync();
    await vi.waitFor(async () => {
      expect(await authStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });
  });

  it('leaves the normal sign-out to the Auth client when it succeeds', async () => {
    authSignOut.mockResolvedValue({ error: null });
    await signOut();
    // The Auth client removes its own storage and reports the change; nothing is forced here.
    expect(await authStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });
});
