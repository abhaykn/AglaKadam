import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayInIndia } from '@shared/accounts.ts';
import { AccessContext } from '@/features/app-shell/access-context';
import { classDetailsQuery, type ClassDetails } from '@/features/attendance/attendance-api';
import type { Access } from '@/features/auth/access';
import { sessionStore } from '@/features/auth/session';
import { deleteDeviceDatabase } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import type { StoredVisit, VisitChange } from './visit-change';
import { clusterVisitsQuery, schoolsOverviewQuery, schoolTeachersQuery } from './visit-api';
import { VisitPage } from './visit-page';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const CRP = '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f9a0';
const OTHER_CRP = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const TEACHER = '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c2';
const CLASS = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SCHOOL = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9';
const CLUSTER = '5e6f7081-92a3-44b5-86c7-d8e9f0a1b2c3';
const VISIT = '0f1e2d3c-4b5a-4968-8776-655443322110';
const today = todayInIndia();

const access: Access = {
  user_id: CRP,
  account_kind: 'staff',
  full_name: 'Sunita Verma',
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
      scope: { type: 'cluster', id: CLUSTER, code: '0901010001', name_en: 'Rampur', name_hi: null },
    },
  ],
  student: null,
};

function storedVisit(overrides: Partial<StoredVisit> = {}): StoredVisit {
  return {
    id: VISIT,
    classSectionId: CLASS,
    schoolId: SCHOOL,
    crpId: CRP,
    teacherId: TEACHER,
    status: 'done',
    plannedOn: null,
    visitedOn: today,
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    finishedAt: null,
    lessonNote: '',
    followsVisitId: null,
    followUpResult: null,
    requestId: null,
    observations: [
      { itemCode: 'every-child-reads', position: 1, answer: null, note: '' },
      { itemCode: 'bottom-group-turns', position: 2, answer: null, note: '' },
    ],
    moments: [],
    rechecks: [],
    feedback: null,
    revision: 1,
    clientChangeId: null,
    ...overrides,
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/crp/visit/$visitId',
    component: () => <VisitPage visitId={VISIT} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/crp/visit/${VISIT}`] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessContext value={access}>
        {/* The test router is not the registered application router. */}
        <RouterProvider router={router as never} />
      </AccessContext>
    </QueryClientProvider>,
  );
}

async function waitingVisit(): Promise<VisitChange> {
  const entry = await offlineRuntime.waitingEntry(`visit:${VISIT}`);
  if (!entry) {
    throw new Error('No visit is waiting on the device.');
  }
  return entry.payload as VisitChange;
}

let queryClient: QueryClient;

beforeEach(async () => {
  setOnline(false);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const details: ClassDetails = {
    id: CLASS,
    grade: 2,
    section: 'A',
    school: { id: SCHOOL, name_en: 'Primary School Rampur', name_hi: null },
  };
  queryClient.setQueryData(classDetailsQuery(CLASS).queryKey, details);
  queryClient.setQueryData(schoolTeachersQuery(SCHOOL).queryKey, [
    { id: TEACHER, fullName: 'Meena Devi' },
  ]);
  queryClient.setQueryData(schoolsOverviewQuery().queryKey, [
    {
      school_id: SCHOOL,
      udise_code: '09010100101',
      name_en: 'Primary School Rampur',
      name_hi: '',
      cluster_id: CLUSTER,
      active_students: 30,
      pending_students: 0,
      teachers: 2,
      current_classes: 3,
    },
  ]);
  sessionStore.set({ status: 'signed-in', userId: CRP, email: null });
  await offlineRuntime.start(CRP, queryClient);
});

afterEach(async () => {
  vi.restoreAllMocks();
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('a visit in progress', () => {
  it('keeps every tap on the phone, with the time it happened', async () => {
    queryClient.setQueryData(clusterVisitsQuery().queryKey, [storedVisit()]);
    renderPage(queryClient);

    await userEvent.click(await screen.findByRole('button', { name: 'Everyone reading' }));
    const item = screen.getByRole('radiogroup', { name: /^1\. Every child read aloud/ });
    await userEvent.click(within(item).getByRole('radio', { name: en.visits.answer.yes }));

    await waitFor(async () => {
      const change = await waitingVisit();
      expect(change.baseRevision).toBe(1);
      expect(change.visit.moments).toEqual([expect.objectContaining({ tagCode: 'all-reading' })]);
      // About twenty minutes into the visit.
      expect(change.visit.moments[0]?.atSeconds).toBeGreaterThanOrEqual(19 * 60);
      expect(change.visit.observations[0]).toMatchObject({
        itemCode: 'every-child-reads',
        answer: 'yes',
      });
      // The second save builds on the first, which was not answered yet.
      expect(change.supersedes).toHaveLength(1);
    });
    expect(await screen.findByText(en.visits.save.waiting)).toBeInTheDocument();
  });

  it('says a change was not saved when the phone can neither keep nor send it', async () => {
    // As in a private window, where nothing can be kept on the phone; and there is no network.
    offlineRuntime.stop();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    queryClient.setQueryData(clusterVisitsQuery().queryKey, [storedVisit()]);
    renderPage(queryClient);
    await userEvent.click(await screen.findByRole('button', { name: 'Everyone reading' }));
    expect(await screen.findByText(en.visits.save.notKept)).toBeInTheDocument();
    expect(screen.queryByText(en.visits.save.sent)).toBeNull();
  });

  it('turns the coaching into a practice card the teacher agrees to', async () => {
    queryClient.setQueryData(clusterVisitsQuery().queryKey, [
      storedVisit({
        observations: [{ itemCode: 'every-child-reads', position: 1, answer: 'yes', note: '' }],
      }),
    ]);
    renderPage(queryClient);

    await userEvent.click(await screen.findByRole('button', { name: /Coach/ }));
    await userEvent.type(
      screen.getByLabelText(en.visits.coach.strength),
      'Every child read a line alone.',
    );
    await userEvent.tab();
    await userEvent.click(
      screen.getByRole('button', { name: 'Every child read aloud at least once' }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText(en.visits.coach.practice),
      'paired-reading',
    );
    await userEvent.click(screen.getByRole('button', { name: /Agree/ }));

    expect(await screen.findByText(en.visits.card.title)).toBeInTheDocument();
    expect(screen.getAllByText('Paired reading').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: en.visits.agree.agree }));

    await waitFor(async () => {
      const change = await waitingVisit();
      expect(change.visit.feedback).toMatchObject({
        strength: 'Every child read a line alone.',
        evidence: [{ item: 'every-child-reads' }],
        practiceCode: 'paired-reading',
      });
      expect(change.visit.feedback?.agreedAt).not.toBeNull();
    });
  });

  it("shows another CRP's visit without letting it be changed", async () => {
    queryClient.setQueryData(clusterVisitsQuery().queryKey, [storedVisit({ crpId: OTHER_CRP })]);
    renderPage(queryClient);
    expect(await screen.findByText('Every child read aloud at least once')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Everyone reading' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: en.visits.visit.stepsLabel })).toBeNull();
  });
});
