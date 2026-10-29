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
import { sessionStore } from '@/features/auth/session';
import { deleteDeviceDatabase } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import { monthOf, pulseCycleQuery, type PulseCycleView } from '@/features/pulse/pulse-api';
import type { PulseChild } from '@/features/pulse/pulse-change';
import {
  attendanceDaysQuery,
  classDetailsQuery,
  classRosterQuery,
  type ClassDetails,
  type RosterEntry,
} from './attendance-api';
import { AttendancePage } from './attendance-page';

const insert = vi.hoisted(() => vi.fn());
/** The attendance records the stand-in server holds; reads of the table return them. */
const serverRows = vi.hoisted((): unknown[] => []);

/** A query chain that answers every read with the rows the server holds for the table. */
function readOf(table: string) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'attendance_sessions' ? [...serverRows] : [],
        error: null,
      }).then(resolve),
  };
  for (const method of ['select', 'eq', 'gte', 'lte', 'or', 'in', 'is', 'order']) {
    chain[method] = () => chain;
  }
  return chain;
}

vi.mock('@/lib/supabase', () => {
  const getSupabase = () => ({
    from: (table: string) => ({
      ...readOf(table),
      insert: (values: { absent_student_ids: string[]; attendance_date: string }) => {
        insert(values);
        const saved = {
          attendance_date: values.attendance_date,
          absent_student_ids: values.absent_student_ids,
          enrolled_count: 3,
          present_count: 3 - values.absent_student_ids.length,
          updated_at: '2026-10-18T05:00:00.000001+00:00',
        };
        serverRows.push(saved);
        const chain = {
          select: () => chain,
          single: () => Promise.resolve({ data: saved, error: null }),
        };
        return chain;
      },
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'teacher-1' } } } }),
    },
  });
  // Waiting changes are sent with a client bound to the account's token.
  return { getSupabase, createClientForToken: () => getSupabase() };
});

const CLASS_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ASHA = '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b';
const RAVI = '1c9d8d66-7d7f-4a8d-8b5c-3a4b2f6e7d8c';
const KIRAN = '2dae9e77-8e80-4b9e-9c6d-4b5c3a7f8e9d';
const today = todayInIndia();

function roster(): RosterEntry[] {
  return [
    {
      studentId: RAVI,
      fullName: 'Ravi',
      studentCode: '1000000016',
      enrolledOn: '2026-04-01',
      endedOn: null,
    },
    {
      studentId: ASHA,
      fullName: 'Asha',
      studentCode: '1000000008',
      enrolledOn: '2026-04-01',
      endedOn: null,
    },
    {
      studentId: KIRAN,
      fullName: 'Kiran',
      studentCode: '1000000024',
      enrolledOn: '2026-04-01',
      endedOn: null,
    },
  ];
}

/** A child drawn for this month's Pulse, due today. */
function sampled(
  sampleId: string,
  studentId: string,
  name: string,
  details: Pick<PulseChild, 'absences'> & Partial<PulseChild>,
): PulseChild {
  return {
    sampleId,
    studentId,
    name,
    studentCode: '1000000000',
    adapted: false,
    week: 1,
    opensOn: today,
    dueOn: today,
    replacesSampleId: null,
    replacedAt: null,
    replacementReason: null,
    checks: [],
    ...details,
  };
}

function pulseOf(children: PulseChild[]): PulseCycleView {
  return {
    cycle: {
      id: 'cycle-1',
      month: monthOf(today),
      grade: 2,
      language: 'hi',
      firstWeek: 1,
      sampleSize: 20,
      eligibleCount: 30,
    },
    children,
    seenItems: {},
    weeks: [],
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/attendance/$classId',
    component: () => <AttendancePage classSectionId={CLASS_ID} date={today} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/attendance/${CLASS_ID}`] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

let queryClient: QueryClient;

beforeEach(async () => {
  setOnline(true);
  insert.mockReset();
  serverRows.length = 0;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const details: ClassDetails = {
    id: CLASS_ID,
    grade: 2,
    section: 'A',
    school: { id: 'school-1', name_en: 'Primary School Rampur', name_hi: null },
  };
  queryClient.setQueryData(classDetailsQuery(CLASS_ID).queryKey, details);
  queryClient.setQueryData(classRosterQuery(CLASS_ID).queryKey, roster());
  queryClient.setQueryData(attendanceDaysQuery(CLASS_ID).queryKey, {});
  sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
  await offlineRuntime.start('teacher-1', queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('attendance page', () => {
  it('lists the roll in name order with everyone present at first', async () => {
    renderPage(queryClient);
    const buttons = await screen.findAllByRole('button', { pressed: false });
    const names = buttons.map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Mark Asha absent', 'Mark Kiran absent', 'Mark Ravi absent']);
    expect(screen.getByText('3 present · 0 absent · 3 on the roll')).toBeInTheDocument();
    expect(screen.getByText(en.attendance.status.notMarked)).toBeInTheDocument();
  });

  it('starts from the children marked absent for Pulse that day, while it has no record', async () => {
    queryClient.setQueryData(
      pulseCycleQuery(CLASS_ID).queryKey,
      pulseOf([sampled('sample-1', KIRAN, 'Kiran', { absences: [today] })]),
    );
    renderPage(queryClient);
    expect(
      await screen.findByRole('button', { name: 'Mark Kiran absent', pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 present · 1 absent · 3 on the roll')).toBeInTheDocument();
    expect(screen.getByText(en.attendance.status.notMarked)).toBeInTheDocument();
  });

  it('does not start from an absence for Pulse when the child was recorded later that day', async () => {
    queryClient.setQueryData(
      pulseCycleQuery(CLASS_ID).queryKey,
      pulseOf([
        sampled('sample-1', KIRAN, 'Kiran', { absences: [today] }),
        // Marked absent in the morning, then came and was recorded at noon.
        sampled('sample-2', ASHA, 'Asha', {
          absences: [today],
          checks: [
            {
              id: 'check-1',
              attempt: 1,
              mode: 'recorded',
              classroom: 'normal',
              itemCode: 'hi-g2-p01',
              promptCode: 'en-g2-s01',
              recordedAt: `${today}T06:30:00.000Z`,
            },
          ],
        }),
      ]),
    );
    renderPage(queryClient);
    expect(
      await screen.findByRole('button', { name: 'Mark Kiran absent', pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Asha absent' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('2 present · 1 absent · 3 on the roll')).toBeInTheDocument();
  });

  it('marks a child absent with one tap and uploads the day', async () => {
    renderPage(queryClient);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark Ravi absent' }));
    expect(screen.getByRole('button', { name: 'Mark Ravi absent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('2 present · 1 absent · 3 on the roll')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: en.attendance.save }));
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          class_section_id: CLASS_ID,
          attendance_date: today,
          absent_student_ids: [RAVI],
        }),
      ),
    );
    // The page shows the server's record as soon as it has been accepted.
    expect(await screen.findByText('Uploaded: 2 of 3 present.')).toBeInTheDocument();
  });

  it('keeps the day on the device when there is no network', async () => {
    setOnline(false);
    renderPage(queryClient);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark Asha absent' }));
    await userEvent.click(screen.getByRole('button', { name: en.attendance.save }));

    expect(await screen.findByText(en.attendance.status.waiting)).toBeInTheDocument();
    expect(insert).not.toHaveBeenCalled();
    // The saved version is what the page shows from now on.
    expect(screen.getByRole('button', { name: 'Mark Asha absent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const waiting = await offlineRuntime.waitingChanges(() => null);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.payload).toMatchObject({ date: today, absentStudentIds: [ASHA] });
  });

  it('puts everyone back to present in one step', async () => {
    renderPage(queryClient);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark Asha absent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark Kiran absent' }));
    await userEvent.click(screen.getByRole('button', { name: en.attendance.markAllPresent }));
    expect(screen.getByText('3 present · 0 absent · 3 on the roll')).toBeInTheDocument();
  });

  it('cannot move past today', async () => {
    renderPage(queryClient);
    const navigation = await screen.findByRole('button', { name: en.attendance.nextDay });
    expect(navigation).toBeDisabled();
    expect(
      within(navigation.parentElement ?? document.body).getByRole('button', {
        name: en.attendance.previousDay,
      }),
    ).toBeEnabled();
  });
});
