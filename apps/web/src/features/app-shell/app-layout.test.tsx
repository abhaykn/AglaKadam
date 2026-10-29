import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessQueryOptions, type Access } from '@/features/auth/access';
import { sessionStore } from '@/features/auth/session';
import { AppLayout } from './app-layout';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));
// The header's own controls are tested with their features; here only the shell's states matter.
vi.mock('@/features/offline/sync-center', () => ({ SyncIndicator: () => null }));
vi.mock('./account-menu', () => ({ AccountMenu: () => null }));
vi.mock('./workspace-switcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('@/features/demo/demo-banner', () => ({ DemoBanner: () => null }));

const ACCESS: Access = {
  user_id: 'teacher-1',
  account_kind: 'staff',
  full_name: 'Sunita Verma',
  preferred_language: 'en',
  phone: null,
  is_active: true,
  password_change_required: false,
  assignments: [
    {
      id: 'assignment-1',
      role: 'teacher',
      starts_on: '2026-04-01',
      ends_on: null,
      scope: null,
    },
  ],
  student: null,
};

function setUp(cached: Access | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) {
    queryClient.setQueryData(accessQueryOptions('teacher-1').queryKey, cached);
  }
  const rootRoute = createRootRoute({ component: Outlet });
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app',
    component: AppLayout,
  });
  const pageRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/teacher',
    component: () => <p>Today&apos;s classes</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([layoutRoute.addChildren([pageRoute])]),
    history: createMemoryHistory({ initialEntries: ['/app/teacher'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  sessionStore.set({ status: 'signed-out' });
  rpc.mockReset();
});

describe('the application shell', () => {
  it('keeps the open page when refreshing what the person may do fails', async () => {
    sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'The network is down.' } });
    const queryClient = setUp(ACCESS);
    expect(await screen.findByText("Today's classes")).toBeInTheDocument();
    await act(() => queryClient.refetchQueries({ queryKey: ['access'] }));
    expect(rpc).toHaveBeenCalledWith('my_access');
    // The shell renders again once the failure reaches it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(screen.getByText("Today's classes")).toBeInTheDocument();
  });

  it('offers to try again when nothing is known of the account yet', async () => {
    sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'The network is down.' } });
    setUp(undefined);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Today's classes")).toBeNull();
  });
});
