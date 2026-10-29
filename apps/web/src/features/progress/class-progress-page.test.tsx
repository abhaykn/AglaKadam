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
import { describe, expect, it, vi } from 'vitest';
import { classDetailsQuery, type ClassDetails } from '@/features/attendance/attendance-api';
import en from '@/i18n/locales/en.json';
import { ClassProgressPage } from './class-progress-page';
import { classProgressQuery, type ClassProgress } from './progress-api';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const CLASS = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/progress/$classId',
    component: () => <ClassProgressPage classSectionId={CLASS} />,
  });
  const childRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/child/$studentId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute, childRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/progress/${CLASS}`] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("a class's progress", () => {
  it('shows the trend, the bright spots and each child, readable as a table', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const details: ClassDetails = {
      id: CLASS,
      grade: 2,
      section: 'A',
      school: { id: '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9', name_en: 'Rampur', name_hi: null },
    };
    const progress: ClassProgress = {
      grade: 2,
      months: [
        { month: '2026-09-01', checked: 10, fluent: 2, hesitant: 3, needsSupport: 5 },
        { month: '2026-10-01', checked: 10, fluent: 4, hesitant: 3, needsSupport: 3 },
      ],
      children: [
        {
          studentId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c01',
          fullName: 'Asha',
          latest: 'fluent',
          latestMonth: '2026-10-01',
          previous: 'hesitant',
          wcpm: 52,
          daysMarked: 20,
          daysPresent: 18,
          marksPercent: 72.5,
        },
        {
          studentId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c02',
          fullName: 'Bilal',
          latest: null,
          latestMonth: null,
          previous: null,
          wcpm: null,
          daysMarked: 20,
          daysPresent: 15,
          marksPercent: null,
        },
      ],
    };
    queryClient.setQueryData(classDetailsQuery(CLASS).queryKey, details);
    queryClient.setQueryData(classProgressQuery(CLASS).queryKey, progress);
    renderPage(queryClient);

    expect(await screen.findByText('Progress of Class 2 – A')).toBeInTheDocument();
    expect(screen.getByText('1 child moved up a level')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: en.progress.class.children });
    const asha = within(table).getByRole('row', { name: /Asha/ });
    expect(within(asha).getByText('90%')).toBeInTheDocument();
    expect(within(asha).getByLabelText(en.progress.movement.up)).toBeInTheDocument();
    const bilal = within(table).getByRole('row', { name: /Bilal/ });
    expect(within(bilal).getByText(en.progress.class.notChecked)).toBeInTheDocument();

    // The trend reads out a month, and can be read as a table.
    const october = screen.getByRole('img', { name: /Oct: Fluent 4/ });
    await userEvent.hover(october);
    expect(screen.getByText(/Oct: Fluent 4, Hesitant 3, Needs support 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(en.progress.asTable));
    expect(screen.getAllByRole('table').length).toBe(2);
  });
});
