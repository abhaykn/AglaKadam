import { createClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { signOut } from '@/features/auth/sign-in';
import { sessionStore } from '@/features/auth/session';
import { forgetPushOnSignOut } from '@/features/notifications/push';
import { withSendingPaused } from '@/features/offline/background-sync';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { getEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';
import { DemoError, switchDemoRole, type DemoRole } from './demo-api';

/** Opens a page afresh, so that the application starts again for the account now signed in. */
export function reloadAt(path: string): void {
  window.location.assign(path);
}

/**
 * Exchanges a one-time token for a session without touching the session of this device, so that
 * nothing changes when the exchange fails.
 */
async function sessionForToken(
  tokenHash: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const { supabaseUrl, supabasePublishableKey } = getEnv();
  const separate = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'ak.demo.switch',
    },
  });
  const { data, error } = await separate.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (error || !data.session) {
    throw new DemoError('unexpected');
  }
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

/**
 * Leaves the demonstration account on this device, as signing out does (its data, waiting changes
 * and key are removed), then signs in to another role of the same district, or, without one,
 * returns to the demonstration page.
 *
 * The other role's session is obtained before anything is removed: a switch that fails on the way
 * (a dropped network) leaves the visitor where they were, in their own district.
 */
export function useLeaveDemo(): (next: DemoRole | null) => Promise<void> {
  const queryClient = useQueryClient();
  return async (next) => {
    // The token is asked for while this session still proves which district is the visitor's.
    const session = next ? await sessionForToken(await switchDemoRole(next)) : null;
    const current = sessionStore.get();
    await withSendingPaused(async () => {
      if (current.status === 'signed-in') {
        await forgetPushOnSignOut();
        await offlineRuntime.forgetAccount(current.userId).catch(() => undefined);
      }
      await signOut();
    });
    queryClient.clear();
    if (session) {
      const { error } = await getSupabase().auth.setSession(session);
      // The new role's session is already open; should keeping it on this device fail, the
      // visitor starts again from the demonstration page instead of an empty screen.
      reloadAt(error ? '/demo' : '/app');
    } else {
      reloadAt('/demo');
    }
  };
}
