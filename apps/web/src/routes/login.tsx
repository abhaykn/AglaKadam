import { createFileRoute, redirect } from '@tanstack/react-router';
import { initialiseSession, sessionStore } from '@/features/auth/session';
import { LoginPage } from '@/features/auth/login-page';

interface LoginSearch {
  redirect?: string;
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.redirect === 'string' && search.redirect.startsWith('/app')
      ? { redirect: search.redirect }
      : {},
  beforeLoad: async () => {
    await initialiseSession();
    if (sessionStore.get().status === 'signed-in') {
      throw redirect({ to: '/app' });
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: redirectTo } = Route.useSearch();
  return <LoginPage redirectTo={redirectTo} />;
}
