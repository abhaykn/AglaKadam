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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessContext } from '@/features/app-shell/access-context';
import type { Access } from '@/features/auth/access';
import type { ClassSignal } from '@/features/visits/plan';
import {
  clusterVisitsQuery,
  crpSignalQuery,
  crpTasksQuery,
  schoolsOverviewQuery,
} from '@/features/visits/visit-api';
import type { StoredVisit } from '@/features/visits/visit-change';
import en from '@/i18n/locales/en.json';
import { CrpHome } from './crp-home';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const CRP = '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f9a0';
const CLUSTER = '3c4d5e6f-7081-4293-a4b5-c6d7e8f9a0b1';
const SCHOOL = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9';
const PLANNED_CLASS = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER_CLASS = '7a2d3b4c-5e6f-4a70-8b8c-9d0e1f2a3b4c';

const access: Access = {
  user_id: CRP,
  account_kind: 'staff',
  full_name: 'Rajeev Kumar Mishra',
  preferred_language: 'en',
  phone: null,
  is_active: true,
  password_change_required: false,
  assignments: [
    {
      id: 'assignment-1',
      role: 'crp',
      starts_on: '2026-04-01',
      ends_on: null,
      scope: { type: 'cluster', id: CLUSTER, code: 'C1', name_en: 'Rampur', name_hi: null },
    },
  ],
  student: null,
};

function signal(classSectionId: string, grade: number, checkBackOn: string): ClassSignal {
  return {
    classSectionId,
    schoolId: SCHOOL,
    grade,
    section: 'A',
    medium: 'hi',
    pulseMonth: '2026-10-01',
    pulseChecked: 18,
    needsSupport: 6,
    hesitant: 6,
    fluent: 6,
    englishNoResponse: 3,
    toListen: 0,
    lastVisitOn: '2026-09-21',
    visitsThisYear: 3,
    checkBackOn,
    checkBackVisitId: null,
    requestTopic: null,
    requestedAt: null,
    marksToDiscuss: 0,
  };
}

const planned: StoredVisit = {
  id: '0f1e2d3c-4b5a-4968-8776-655443322110',
  classSectionId: PLANNED_CLASS,
  schoolId: SCHOOL,
  crpId: CRP,
  teacherId: null,
  status: 'planned',
  // The Tuesday after this Saturday.
  plannedOn: '2026-10-27',
  visitedOn: null,
  startedAt: null,
  finishedAt: null,
  lessonNote: '',
  followsVisitId: null,
  followUpResult: null,
  requestId: null,
  observations: [],
  moments: [],
  rechecks: [],
  feedback: null,
  revision: 1,
  clientChangeId: null,
};

beforeEach(() => {
  // A Saturday morning in India, when the week's last day leaves little of it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T04:30:00Z'));
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a CRP's home", () => {
  it('shows visits planned into next week, and never suggests a planned class again', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(clusterVisitsQuery().queryKey, [planned]);
    queryClient.setQueryData(crpSignalQuery().queryKey, [
      signal(PLANNED_CLASS, 1, '2026-09-23'),
      signal(OTHER_CLASS, 2, '2026-10-05'),
    ]);
    queryClient.setQueryData(crpTasksQuery().queryKey, []);
    queryClient.setQueryData(schoolsOverviewQuery().queryKey, [
      {
        school_id: SCHOOL,
        udise_code: '09010100101',
        name_en: 'Primary School Bhagwanpur',
        name_hi: '',
        cluster_id: CLUSTER,
        active_students: 75,
        pending_students: 0,
        teachers: 2,
        current_classes: 3,
      },
    ]);
    const rootRoute = createRootRoute({ component: Outlet });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/app/crp',
      component: CrpHome,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/app/crp'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccessContext value={access}>
          {/* The test router is not the registered application router. */}
          <RouterProvider router={router as never} />
        </AccessContext>
      </QueryClientProvider>,
    );

    const coming = await screen.findByRole('region', { name: en.visits.home.weekTitle });
    expect(within(coming).getByText('Class 1 – A · Primary School Bhagwanpur')).toBeTruthy();
    expect(within(coming).getByText(/27 Oct/)).toBeTruthy();
    const next = screen.getByRole('region', { name: en.visits.home.nextTitle });
    expect(within(next).queryByText(/Class 1 – A/)).toBeNull();
    expect(within(next).getByText(/Class 2 – A/)).toBeTruthy();
  });
});
