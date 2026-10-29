import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { signOut } from '@/features/auth/sign-in';
import { sessionStore } from '@/features/auth/session';
import { withSendingPaused } from '@/features/offline/background-sync';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { forgetPushOnSignOut } from '@/features/notifications/push';
import { syncStatusStore } from '@/features/offline/sync-status';
import { createStore } from '@/lib/store';

/** Set while the person is asked to confirm signing out with changes that are not uploaded. */
export const signOutConfirmationStore = createStore<boolean>(false);

/** Set while signing out, so that the screen shows that it is busy and a second tap does nothing. */
export const signingOutStore = createStore<boolean>(false);

/**
 * Signs out on purpose: everything this account keeps on the device (its encrypted data, waiting
 * changes and key) is removed, then the session ends and the sign-in page opens.
 */
export function useFinishSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    if (signingOutStore.get()) {
      return;
    }
    signingOutStore.set(true);
    signOutConfirmationStore.set(false);
    try {
      const session = sessionStore.get();
      await withSendingPaused(async () => {
        if (session.status === 'signed-in') {
          // While the session is still valid, so that the server forgets this phone too.
          await forgetPushOnSignOut();
          await offlineRuntime.forgetAccount(session.userId).catch(() => undefined);
        }
        await signOut();
      });
      queryClient.clear();
      await navigate({ to: '/login', replace: true });
    } finally {
      signingOutStore.set(false);
    }
  };
}

/**
 * Signs out, but first asks for confirmation when changes saved on this device have not been
 * uploaded yet, because signing out deletes them.
 */
export function useSignOut(): () => Promise<void> {
  const finish = useFinishSignOut();
  return async () => {
    if (signingOutStore.get()) {
      return;
    }
    await offlineRuntime.refreshStatus().catch(() => undefined);
    const { pending, failed } = syncStatusStore.get();
    if (pending + failed > 0) {
      signOutConfirmationStore.set(true);
      return;
    }
    await finish();
  };
}
