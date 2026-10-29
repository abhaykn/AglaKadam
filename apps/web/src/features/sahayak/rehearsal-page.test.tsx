import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import type * as FunctionsModule from '@/lib/functions';
import { FunctionCallError } from '@/lib/functions';
import { debriefsQuery } from './sahayak-api';
import { RehearsalPage } from './rehearsal-page';

const calls: Record<string, unknown>[] = [];
const answers: unknown[] = [];

vi.mock('@/lib/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof FunctionsModule>();
  return {
    ...actual,
    callFunction: (_name: string, body: Record<string, unknown>) => {
      calls.push(body);
      const next = answers.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/crp/rehearse',
    component: RehearsalPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ['/app/crp/rehearse'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  calls.length = 0;
  answers.length = 0;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(debriefsQuery().queryKey, []);
});

describe('the rehearsal room', () => {
  it('plays a conversation with the simulated teacher, then shows and keeps the debrief', async () => {
    renderPage(queryClient);
    await userEvent.click(await screen.findByRole('radio', { name: 'English' }));
    const scenario = en.sahayak.rehearsal.scenarios['tired-veteran'];
    const starts = await screen.findAllByRole('button', { name: en.sahayak.rehearsal.start });
    await userEvent.click(starts[0]!);
    expect(await screen.findByText(scenario.opening)).toBeInTheDocument();

    const field = screen.getByLabelText(en.sahayak.rehearsal.yourLine);
    answers.push({ reply: 'Ten minutes, maybe.', provider: 'claude' });
    await userEvent.type(field, 'What helps the children who come every day?');
    await userEvent.click(screen.getByRole('button', { name: en.sahayak.rehearsal.send }));
    expect(await screen.findByText('Ten minutes, maybe.')).toBeInTheDocument();
    expect(calls[0]).toEqual({
      action: 'rehearse',
      language: 'en',
      scenario: 'tired-veteran',
      messages: [
        { role: 'teacher', text: scenario.opening },
        { role: 'crp', text: 'What helps the children who come every day?' },
      ],
    });
    // A debrief needs two things said.
    expect(screen.getByRole('button', { name: en.sahayak.rehearsal.finish })).toBeDisabled();

    // A failed answer gives the line back to the field.
    answers.push(new FunctionCallError('ai_unavailable', 503));
    await userEvent.type(field, 'Shall we try paired reading on Monday?');
    await userEvent.click(screen.getByRole('button', { name: en.sahayak.rehearsal.send }));
    expect(await screen.findByText(en.sahayak.errors.unavailable)).toBeInTheDocument();
    expect(field).toHaveValue('Shall we try paired reading on Monday?');

    answers.push({ reply: 'All right, Monday.', provider: 'groq' });
    await userEvent.click(screen.getByRole('button', { name: en.sahayak.rehearsal.send }));
    expect(await screen.findByText('All right, Monday.')).toBeInTheDocument();

    answers.push({
      debrief: {
        id: 'debrief-1',
        scenario: 'tired-veteran',
        turns: 2,
        named_practice: true,
        asked_constraints: true,
        agreed_check_back: true,
        kept_blame_out: true,
        cited_evidence: false,
        went_well: 'You asked what already helps.',
        try_next: 'Mention the back rows you saw.',
        created_at: '2026-10-22T10:00:00.000Z',
      },
    });
    await userEvent.click(screen.getByRole('button', { name: en.sahayak.rehearsal.finish }));
    expect(await screen.findByText('Mention the back rows you saw.')).toBeInTheDocument();
    expect(screen.getByText(en.sahayak.rehearsal.checks.citedEvidence)).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ action: 'debrief', scenario: 'tired-veteran' });

    await userEvent.click(screen.getByRole('button', { name: en.sahayak.rehearsal.another }));
    await waitFor(() => {
      expect(screen.getByText('4 of 5 checks', { exact: false })).toBeInTheDocument();
    });
  }, 30_000);

  it('offers nothing without a network', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    renderPage(queryClient);
    expect(await screen.findByText(en.sahayak.offline)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: en.sahayak.rehearsal.start })) {
      expect(button).toBeDisabled();
    }
  });
});
