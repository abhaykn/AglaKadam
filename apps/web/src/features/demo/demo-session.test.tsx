import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EnvModule from '@/lib/env';
import { useLeaveDemo } from './demo-session';

const calls = vi.hoisted(() => ({
  callFunction: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  signOut: vi.fn(),
  forgetAccount: vi.fn(),
  assign: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { verifyOtp: calls.verifyOtp } }),
}));
vi.mock('@/lib/functions', () => ({
  callFunction: calls.callFunction,
  FunctionCallError: class extends Error {},
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { setSession: calls.setSession } }),
}));
vi.mock('@/lib/env', async (original) => ({
  ...(await original<typeof EnvModule>()),
  getEnv: () => ({
    appEnvironment: 'development',
    demoWorkspaceEnabled: true,
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_example0000',
  }),
}));
vi.mock('@/features/auth/sign-in', () => ({ signOut: calls.signOut }));
vi.mock('@/features/auth/session', () => ({
  sessionStore: { get: () => ({ status: 'signed-in', userId: 'teacher-user', email: null }) },
}));
vi.mock('@/features/notifications/push', () => ({ forgetPushOnSignOut: () => Promise.resolve() }));
vi.mock('@/features/offline/background-sync', () => ({
  withSendingPaused: (work: () => Promise<unknown>) => work(),
}));
vi.mock('@/features/offline/offline-runtime', () => ({
  offlineRuntime: { forgetAccount: calls.forgetAccount },
}));

const originalLocation = window.location;

beforeEach(() => {
  for (const spy of Object.values(calls)) {
    spy.mockReset();
  }
  calls.signOut.mockResolvedValue(undefined);
  calls.forgetAccount.mockResolvedValue(undefined);
  calls.setSession.mockResolvedValue({ error: null });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: originalLocation.href, assign: calls.assign },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

function leave() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useLeaveDemo(), { wrapper }).result.current;
}

describe('switching roles in a demonstration district', () => {
  it('keeps the visitor where they were when the new role cannot be opened', async () => {
    calls.callFunction.mockResolvedValue({ token_hash: 'one-time' });
    calls.verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error('expired') });
    await expect(leave()('officer')).rejects.toThrow();
    expect(calls.signOut).not.toHaveBeenCalled();
    expect(calls.forgetAccount).not.toHaveBeenCalled();
    expect(calls.assign).not.toHaveBeenCalled();
  });

  it('signs out of this role only once the next one is open, then opens it', async () => {
    calls.callFunction.mockResolvedValue({ token_hash: 'one-time' });
    calls.verifyOtp.mockResolvedValue({
      data: { session: { access_token: 'access', refresh_token: 'refresh' } },
      error: null,
    });
    await leave()('officer');
    expect(calls.callFunction).toHaveBeenCalledWith('demo', { action: 'switch', role: 'officer' });
    expect(calls.forgetAccount).toHaveBeenCalledWith('teacher-user');
    expect(calls.signOut).toHaveBeenCalled();
    expect(calls.setSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    });
    expect(calls.assign).toHaveBeenCalledWith('/app');
  });

  it('returns to the demonstration page when the visitor ends the demo', async () => {
    await leave()(null);
    expect(calls.callFunction).not.toHaveBeenCalled();
    expect(calls.signOut).toHaveBeenCalled();
    expect(calls.assign).toHaveBeenCalledWith('/demo');
  });
});
