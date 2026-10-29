import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppLayout } from '@/features/app-shell/app-layout';
import { initialiseSession, sessionStore } from '@/features/auth/session';
import '@/features/offline/changes';
import { offlineRuntime } from '@/features/offline/offline-runtime';

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ context, location }) => {
    await initialiseSession();
    const session = sessionStore.get();
    if (session.status !== 'signed-in') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    // Restores the data kept on this device before the first screen renders, so the application
    // opens with it even without a network.
    await offlineRuntime.start(session.userId, context.queryClient);
  },
  component: AppLayout,
});
