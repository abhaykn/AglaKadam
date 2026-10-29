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
import {
  classDetailsQuery,
  classRosterQuery,
  type ClassDetails,
  type RosterEntry,
} from '@/features/attendance/attendance-api';
import { sessionStore } from '@/features/auth/session';
import { deleteDeviceDatabase } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import { audioConsentQuery, type ClassConsent } from './consent-api';
import { ConsentPage } from './consent-page';

const upsert = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => {
  const getSupabase = () => ({
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => {
        upsert(table, values, options);
        return Promise.resolve({ error: null });
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

const roster: RosterEntry[] = [
  {
    studentId: ASHA,
    fullName: 'Asha',
    studentCode: '1000000008',
    enrolledOn: '2026-04-01',
    endedOn: null,
  },
  {
    studentId: RAVI,
    fullName: 'Ravi',
    studentCode: '1000000016',
    enrolledOn: '2026-04-01',
    endedOn: null,
  },
];

const details: ClassDetails = {
  id: CLASS_ID,
  grade: 2,
  section: 'A',
  school: { id: 'school-1', name_en: 'Primary School Rampur', name_hi: null },
};

const consent: ClassConsent = {
  decisions: {
    [ASHA]: {
      granted: true,
      guardianName: 'Sunita Devi',
      method: 'paper_form',
      recordedAt: '2026-10-10T05:00:00Z',
    },
  },
  guardianNames: { [RAVI]: 'Mohan Lal' },
};

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/pulse/$classId/consent',
    component: () => <ConsentPage classSectionId={CLASS_ID} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/pulse/${CLASS_ID}/consent`] }),
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
  upsert.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(classDetailsQuery(CLASS_ID).queryKey, details);
  queryClient.setQueryData(classRosterQuery(CLASS_ID).queryKey, roster);
  queryClient.setQueryData(audioConsentQuery(CLASS_ID).queryKey, consent);
  sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
  await offlineRuntime.start('teacher-1', queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('consent page', () => {
  it('shows each child’s decision and how many have consent', async () => {
    renderPage(queryClient);
    expect(await screen.findByText('1 of 2 children have consent.')).toBeInTheDocument();
    const [ashaRow, raviRow] = screen.getAllByRole('listitem');
    expect(within(ashaRow!).getByText(/^Agreed/)).toBeInTheDocument();
    expect(within(raviRow!).getByText(en.consent.status.none)).toBeInTheDocument();
  });

  it('records a decision with the guardian named on the class list, offline too', async () => {
    setOnline(false);
    renderPage(queryClient);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Record the decision for Ravi' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(en.consent.form.guardianName)).toHaveValue('Mohan Lal');

    // The decision must be chosen.
    await userEvent.click(within(dialog).getByRole('button', { name: en.consent.form.save }));
    expect(within(dialog).getByText(en.consent.form.decisionRequired)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: en.consent.form.granted }));
    await userEvent.click(within(dialog).getByRole('button', { name: en.consent.form.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(await screen.findByText('2 of 2 children have consent.')).toBeInTheDocument();
    expect(screen.getByText(en.consent.status.grantedOnDevice)).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
    const [waiting] = await offlineRuntime.waitingChanges(() => null);
    expect(waiting).toMatchObject({
      kind: 'consent.audio',
      payload: { studentId: RAVI, granted: true, guardianName: 'Mohan Lal', method: 'paper_form' },
    });
  });

  it('sends a withdrawal at once when online', async () => {
    renderPage(queryClient);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Record the decision for Asha' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(en.consent.form.guardianName)).toHaveValue('Sunita Devi');
    await userEvent.click(within(dialog).getByRole('radio', { name: en.consent.form.refused }));
    await userEvent.click(within(dialog).getByRole('radio', { name: en.consent.form.inPerson }));
    await userEvent.click(within(dialog).getByRole('button', { name: en.consent.form.save }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        'guardian_consents',
        expect.objectContaining({
          student_id: ASHA,
          purpose: 'audio_assessment',
          granted: false,
          guardian_name: 'Sunita Devi',
          method: 'in_person',
          // Dated when the teacher recorded it, not when the server receives it.
          recorded_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        }),
        { onConflict: 'id', ignoreDuplicates: true },
      ),
    );
  });

  it('requires the guardian’s name', async () => {
    queryClient.setQueryData(audioConsentQuery(CLASS_ID).queryKey, {
      decisions: {},
      guardianNames: {},
    });
    renderPage(queryClient);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Record the decision for Ravi' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: en.consent.form.granted }));
    await userEvent.click(within(dialog).getByRole('button', { name: en.consent.form.save }));
    expect(within(dialog).getByText(en.consent.form.nameRequired)).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
  });
});
