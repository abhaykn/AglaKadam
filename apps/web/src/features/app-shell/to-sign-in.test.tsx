import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToSignIn } from './to-sign-in';

/** A layout that renders again whenever the location changes, as the application's layout does. */
function SignedOutLayout() {
  useLocation();
  return <ToSignIn />;
}

function setUp(start: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/$page',
    component: SignedOutLayout,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/demo',
    component: SignedOutLayout,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    validateSearch: (search: Record<string, unknown>) => search,
    // The sign-in page takes a moment to load, while the layout is still on screen.
    beforeLoad: () => new Promise<void>((resolve) => setTimeout(resolve, 60)),
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute, otherRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: [start] }),
  });
  const navigations: string[] = [];
  router.subscribe('onBeforeNavigate', (event) => navigations.push(event.toLocation.href));
  // The test router is not the registered application router.
  const { unmount } = render(<RouterProvider router={router as never} />);
  return { router, navigations, unmount };
}

/**
 * Waits until the router has finished loading the sign-in page. A test that ends while the router
 * is still working leaves a navigation running after the test window is gone, which on a slow
 * machine fails the whole run with "window is not defined".
 */
async function settled(router: { state: { status: string } }) {
  await waitFor(() => expect(router.state.status).toBe('idle'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await waitFor(() => expect(router.state.status).toBe('idle'));
}

describe('leaving a signed-out page for sign-in', () => {
  it('goes to the sign-in page once, returning to the page the person was on', async () => {
    const { router, navigations, unmount } = setUp('/app/teacher?tab=pulse');
    await waitFor(() => expect(router.state.status).toBe('idle'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await settled(router);
    expect(router.state.location.search).toEqual({ redirect: '/app/teacher?tab=pulse' });
    expect(navigations.filter((href) => href.startsWith('/login'))).toHaveLength(1);
    unmount();
  });

  it('does not offer a page outside the application to return to', async () => {
    const { router, unmount } = setUp('/demo');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await settled(router);
    expect(router.state.location.search).toEqual({});
    unmount();
  });
});
