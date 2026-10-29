import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Access } from '@/features/auth/access';
import en from '@/i18n/locales/en.json';
import { TutorLauncher } from './tutor-launcher';

const access: Access = {
  user_id: 'user-1',
  account_kind: 'staff',
  full_name: 'Teacher',
  preferred_language: 'en',
  phone: null,
  is_active: true,
  password_change_required: false,
  assignments: [{ id: 'a', role: 'teacher', starts_on: '2026-01-01', ends_on: null, scope: null }],
  student: null,
};

function renderLauncher(current: Access = access) {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/teacher',
    component: () => <TutorLauncher access={current} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/app/teacher'] }),
  });
  // The test router is not the registered application router.
  return render(<RouterProvider router={router as never} />);
}

describe('the button that opens Disha', () => {
  it('opens the conversation with one tap and closes it with the next', async () => {
    // The open drawer locks the page behind it; the button itself stays reachable.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderLauncher();
    const button = await screen.findByRole('button', { name: en.tutor.ask });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(button);
    expect(await screen.findByRole('dialog', { name: /Disha/ })).toBeInTheDocument();
    // Behind the open drawer the button is hidden from screen readers (the drawer has its own
    // close button), but it stays within reach of the pointer.
    const close = screen.getByRole('button', { name: en.tutor.closeChat, hidden: true });
    expect(close).toHaveAttribute('aria-expanded', 'true');

    await user.click(close);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('button', { name: en.tutor.ask })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('is not offered to an account that must first choose a new password', async () => {
    renderLauncher({ ...access, password_change_required: true });
    // Give the router time to render before looking for what is not there.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole('button', { name: en.tutor.ask })).not.toBeInTheDocument();
  });
});
