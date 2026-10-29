import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import type * as EnvModule from '@/lib/env';
import { FunctionCallError } from '@/lib/functions';
import type * as FunctionsModule from '@/lib/functions';
import { DemoBanner } from './demo-banner';
import { myDemoQuery, type MyDemo } from './demo-api';
import { DemoPage } from './demo-page';
import type * as SessionModule from './demo-session';

const calls = vi.hoisted(() => ({
  callFunction: vi.fn(),
  verifyOtp: vi.fn(),
  reloadAt: vi.fn(),
}));

vi.mock('@/lib/functions', async (original) => ({
  ...(await original<typeof FunctionsModule>()),
  callFunction: calls.callFunction,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { verifyOtp: calls.verifyOtp } }),
}));

vi.mock('@/lib/env', async (original) => {
  const actual = await original<typeof EnvModule>();
  return {
    ...actual,
    getEnv: () => ({
      appEnvironment: 'development',
      demoWorkspaceEnabled: true,
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'sb_publishable_example0000',
    }),
  };
});

vi.mock('./demo-session', async (original) => ({
  ...(await original<typeof SessionModule>()),
  reloadAt: calls.reloadAt,
}));

function renderAt(node: ReactNode, queryClient = new QueryClient()) {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/demo',
    component: () => node,
  });
  const other = createRoute({
    getParentRoute: () => rootRoute,
    path: '/$any',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page, other]),
    history: createMemoryHistory({ initialEntries: ['/demo'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.callFunction.mockReset();
  calls.verifyOtp.mockReset();
  calls.reloadAt.mockReset();
});

describe('the demonstration page', () => {
  it('asks for a role, builds the district and signs the visitor in', async () => {
    calls.callFunction.mockResolvedValue({ token_hash: 'one-time', role: 'crp' });
    calls.verifyOtp.mockResolvedValue({ error: null });
    renderAt(<DemoPage initialRole={null} />);

    const start = await screen.findByRole('button', { name: en.demo.page.start });
    expect(start).toBeDisabled();
    const roles = screen.getAllByRole('radio');
    expect(roles.map((role) => role.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining(en.demo.roles.crp.title)]),
    );
    await userEvent.click(screen.getByRole('radio', { name: en.demo.roles.crp.title }));
    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    await userEvent.click(screen.getByRole('button', { name: /Open the demo as the CRP/ }));

    expect(calls.callFunction).toHaveBeenCalledWith('demo', {
      action: 'start',
      role: 'crp',
      language: 'en',
    });
    expect(calls.verifyOtp).toHaveBeenCalledWith({ token_hash: 'one-time', type: 'email' });
    expect(calls.reloadAt).toHaveBeenCalledWith('/app');
  });

  it('opens with a role chosen from the link, and says when every district is in use', async () => {
    calls.callFunction.mockRejectedValue(new FunctionCallError('busy', 503));
    renderAt(<DemoPage initialRole="family" />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Open the demo as the family/ }),
    );
    expect(await screen.findByText(en.demo.errors.busy)).toBeInTheDocument();
    expect(calls.reloadAt).not.toHaveBeenCalled();
    // The visitor can try again from the same choice.
    expect(screen.getByRole('radio', { name: en.demo.roles.family.title })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('the demonstration banner', () => {
  it('says the data is simulated, who the visitor is, and offers the other roles', async () => {
    const queryClient = new QueryClient();
    const demo: MyDemo = {
      role: 'crp',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      school: 'Primary School Bhagwanpur',
      schoolHi: 'प्राथमिक विद्यालय भगवानपुर',
      people: {
        teacher: 'Anita Sharma',
        crp: 'Rajeev Kumar Mishra',
        officer: 'Suresh Chandra Dubey',
        family: 'Jyoti Sonkar',
      },
    };
    queryClient.setQueryData(myDemoQuery().queryKey, demo);
    renderAt(<DemoBanner userId="crp-user" />, queryClient);

    expect(await screen.findByText(en.demo.banner.label)).toBeInTheDocument();
    expect(screen.getByText(/you are the CRP, Rajeev Kumar Mishra/)).toBeInTheDocument();

    // The guide opens by itself the first time, with the district's own people.
    const guide = await screen.findByRole('dialog');
    expect(
      within(guide).getByText(/Verify the two children Anita Sharma added/),
    ).toBeInTheDocument();
    await userEvent.click(within(guide).getByRole('button', { name: en.demo.guide.close }));

    await userEvent.click(screen.getByRole('button', { name: en.demo.banner.switch }));
    const options = await screen.findAllByRole('menuitem');
    expect(options.map((option) => option.textContent)).toEqual([
      `${en.demo.roles.teacher.title}Anita Sharma`,
      `${en.demo.roles.officer.title}Suresh Chandra Dubey`,
      `${en.demo.roles.family.title}Jyoti Sonkar`,
    ]);
  });
});
