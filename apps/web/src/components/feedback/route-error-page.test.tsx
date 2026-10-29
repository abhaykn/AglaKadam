import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import { isStaleCodeError } from '@/features/pwa/service-worker';
import { RouteErrorPage } from './route-error-page';

function showFailure(error: Error) {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const rootRoute = createRootRoute({
    component: () => {
      throw error;
    },
    errorComponent: RouteErrorPage,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // The test router is not the registered application router.
  render(<RouterProvider router={router as never} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the page shown when something fails', () => {
  it('recognises the messages browsers give for a part that could not be loaded', () => {
    expect(
      isStaleCodeError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://example.org/assets/a.js',
        ),
      ),
    ).toBe(true);
    expect(isStaleCodeError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleCodeError(new Error('Unable to preload CSS for /assets/b.css'))).toBe(true);
    expect(isStaleCodeError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('offers to reload when the page runs a version that was replaced', async () => {
    showFailure(new TypeError('Failed to fetch dynamically imported module: /assets/page.js'));
    expect(await screen.findByText(en.errorBoundary.staleBody)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.common.reload })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.errorBoundary.retry })).toBeNull();
  });

  it('offers to try again after any other failure', async () => {
    showFailure(new Error('Cannot read properties of undefined'));
    expect(await screen.findByText(en.errorBoundary.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.errorBoundary.retry })).toBeInTheDocument();
  });
});
