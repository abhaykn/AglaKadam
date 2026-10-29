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
import { classDetailsQuery, type ClassDetails } from '@/features/attendance/attendance-api';
import { addDays } from '@/features/attendance/dates';
import { sessionStore } from '@/features/auth/session';
import { audioConsentQuery } from '@/features/consent/consent-api';
import { deleteDeviceDatabase } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import {
  monthOf,
  pulseCycleQuery,
  type PulseChild,
  type PulseCycleView,
  type PulseWeek,
} from './pulse-api';
import { PulsePage } from './pulse-page';

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
const today = todayInIndia();

function child(overrides: Partial<PulseChild>): PulseChild {
  return {
    sampleId: crypto.randomUUID(),
    studentId: crypto.randomUUID(),
    name: 'Asha',
    studentCode: '1000000008',
    adapted: false,
    week: 1,
    opensOn: today,
    dueOn: today,
    replacesSampleId: null,
    replacedAt: null,
    replacementReason: null,
    checks: [],
    absences: [],
    ...overrides,
  };
}

const asha = child({ name: 'Asha', dueOn: addDays(today, 3) });
const mina = child({ name: 'Mina', studentCode: '1000000032', dueOn: addDays(today, 4) });
const ravi = child({ name: 'Ravi', studentCode: '1000000016', dueOn: addDays(today, -1) });
const kiran = child({
  name: 'Kiran',
  studentCode: '1000000024',
  checks: [
    {
      id: crypto.randomUUID(),
      attempt: 1,
      mode: 'recorded',
      classroom: 'noisy',
      itemCode: 'hi-g2-p03',
      promptCode: 'en-g2-s03',
      recordedAt: `${today}T05:00:00Z`,
    },
  ],
});

function view(children: PulseChild[], cycle = true, weeks: PulseWeek[] = []): PulseCycleView {
  return {
    cycle: cycle
      ? {
          id: crypto.randomUUID(),
          month: monthOf(today),
          grade: 2,
          language: 'hi',
          firstWeek: 1,
          sampleSize: 20,
          eligibleCount: 34,
        }
      : null,
    children,
    seenItems: {},
    weeks,
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/pulse/$classId',
    component: () => <PulsePage classSectionId={CLASS_ID} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/pulse/${CLASS_ID}`] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

function details(grade: number): ClassDetails {
  return {
    id: CLASS_ID,
    grade,
    section: 'A',
    school: { id: 'school-1', name_en: 'Primary School Rampur', name_hi: null },
  };
}

let queryClient: QueryClient;

beforeEach(async () => {
  setOnline(true);
  upsert.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(classDetailsQuery(CLASS_ID).queryKey, details(2));
  queryClient.setQueryData(pulseCycleQuery(CLASS_ID).queryKey, view([asha, mina, ravi, kiran]));
  sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
  await offlineRuntime.start('teacher-1', queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('Pulse page', () => {
  it('shows the children due, late ones first, and how many are still hidden', async () => {
    renderPage(queryClient);
    const due = await screen.findByRole('region', { name: en.pulse.dueTitle });
    const names = within(due)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent);
    expect(names).toEqual(['Ravi', 'Asha', 'Mina']);
    expect(within(due).getAllByRole('link', { name: en.pulse.record })).toHaveLength(3);
    // A late child can still be recorded, but no longer marked absent.
    const [raviRow] = within(due).getAllByRole('listitem');
    expect(
      within(raviRow!).queryByRole('button', { name: en.pulse.absentToday }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('1 of 20')).toBeInTheDocument();
    expect(
      screen.getByText('16 more children will appear in the coming weeks.'),
    ).toBeInTheDocument();

    const recorded = screen.getByRole('region', { name: en.pulse.recordedTitle });
    expect(within(recorded).getByText('Kiran')).toBeInTheDocument();
    expect(within(recorded).getByRole('link', { name: en.pulse.recordAgain })).toHaveAttribute(
      'href',
      expect.stringContaining('attempt=2'),
    );
  });

  it('keeps an absence on the device without a network', async () => {
    setOnline(false);
    renderPage(queryClient);
    const due = await screen.findByRole('region', { name: en.pulse.dueTitle });
    const [, ashaRow] = within(due).getAllByRole('listitem');
    await userEvent.click(within(ashaRow!).getByRole('button', { name: en.pulse.absentToday }));

    expect(await within(ashaRow!).findByText(en.pulse.badge.absentToday)).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
    const waiting = await offlineRuntime.waitingChanges(() => null);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      kind: 'pulse.absence',
      payload: { sampleId: asha.sampleId, date: today },
    });
  });

  it('sends an absence at once when online', async () => {
    renderPage(queryClient);
    const due = await screen.findByRole('region', { name: en.pulse.dueTitle });
    const [, , minaRow] = within(due).getAllByRole('listitem');
    await userEvent.click(within(minaRow!).getByRole('button', { name: en.pulse.absentToday }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        'pulse_absences',
        { sample_id: mina.sampleId, absent_on: today },
        { onConflict: 'sample_id,absent_on', ignoreDuplicates: true },
      ),
    );
  });

  it('names both parts of the check for the class’s language', async () => {
    renderPage(queryClient);
    expect(
      await screen.findByText(en.pulse.subject.replace('{{language}}', en.pulse.language.hi)),
    ).toBeInTheDocument();
  });

  it('offers the adapted check, not a recording, to a child with special needs', async () => {
    const sunil = child({ name: 'Sunil', adapted: true, dueOn: addDays(today, 5) });
    queryClient.setQueryData(pulseCycleQuery(CLASS_ID).queryKey, view([sunil]));
    renderPage(queryClient);
    const due = await screen.findByRole('region', { name: en.pulse.dueTitle });
    const [row] = within(due).getAllByRole('listitem');
    expect(within(row!).getByText(en.pulse.badge.adapted)).toBeInTheDocument();
    expect(within(row!).getByRole('link', { name: en.pulse.adapted.open })).toHaveAttribute(
      'href',
      expect.stringContaining(sunil.sampleId),
    );
    expect(within(row!).queryByRole('link', { name: en.pulse.record })).not.toBeInTheDocument();
  });

  it('asks for the CRP’s code for a week that opened while the phone was offline', async () => {
    const weeks: PulseWeek[] = [
      { week: 1, opensOn: today, batch: null, key: null },
      {
        week: 2,
        opensOn: today,
        batch: { iv: '00', ciphertext: '00', mac: '00' },
        key: null,
      },
      { week: 3, opensOn: today, batch: null, key: null },
      { week: 4, opensOn: addDays(today, 7), batch: null, key: null },
    ];
    queryClient.setQueryData(
      pulseCycleQuery(CLASS_ID).queryKey,
      view([asha, mina, ravi, kiran], true, weeks),
    );
    renderPage(queryClient);

    // Week 1 has its children; week 4 has not begun.
    expect(
      await screen.findByText(en.pulse.unlock.title.replace('{{week}}', '2')),
    ).toBeInTheDocument();
    expect(screen.getByText(en.pulse.unlock.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.pulse.unlock.scan })).toBeInTheDocument();
    // A week whose children never reached this phone cannot be unlocked with a code.
    expect(screen.getByText(en.pulse.unlock.title.replace('{{week}}', '3'))).toBeInTheDocument();
    expect(screen.getByText(en.pulse.unlock.notOnDevice)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: en.pulse.unlock.scan })).toHaveLength(1);
    expect(
      screen.queryByText(en.pulse.unlock.title.replace('{{week}}', '1')),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(en.pulse.unlock.title.replace('{{week}}', '4')),
    ).not.toBeInTheDocument();
  });

  it('records no child whose family has withdrawn consent', async () => {
    queryClient.setQueryData(audioConsentQuery(CLASS_ID).queryKey, {
      decisions: {
        [asha.studentId]: {
          granted: false,
          guardianName: 'Guardian',
          method: 'paper_form',
          recordedAt: `${today}T04:00:00Z`,
        },
      },
      guardianNames: {},
    });
    renderPage(queryClient);
    const due = await screen.findByRole('region', { name: en.pulse.dueTitle });
    const [, ashaRow, minaRow] = within(due).getAllByRole('listitem');
    expect(within(ashaRow!).getByText(en.pulse.badge.consentWithdrawn)).toBeInTheDocument();
    expect(within(ashaRow!).getByText(en.pulse.consentWithdrawnHint)).toBeInTheDocument();
    expect(within(ashaRow!).queryByRole('link')).not.toBeInTheDocument();
    expect(within(ashaRow!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(minaRow!).getByRole('link', { name: en.pulse.record })).toBeInTheDocument();
  });

  it('offers no second recording once the family has withdrawn consent', async () => {
    queryClient.setQueryData(audioConsentQuery(CLASS_ID).queryKey, {
      decisions: {
        [kiran.studentId]: {
          granted: false,
          guardianName: 'Guardian',
          method: 'paper_form',
          recordedAt: `${today}T06:00:00Z`,
        },
      },
      guardianNames: {},
    });
    renderPage(queryClient);
    const recorded = await screen.findByRole('region', { name: en.pulse.recordedTitle });
    expect(within(recorded).getByText(en.pulse.badge.consentWithdrawn)).toBeInTheDocument();
    expect(
      within(recorded).queryByRole('link', { name: en.pulse.recordAgain }),
    ).not.toBeInTheDocument();
  });

  it('shows what the machine measured in a recording, or that it will do so tonight', async () => {
    renderPage(queryClient);
    const recorded = await screen.findByRole('region', { name: en.pulse.recordedTitle });
    expect(within(recorded).getByText(en.pulse.machine.waiting)).toBeInTheDocument();

    const [first] = kiran.checks;
    const scored = {
      ...kiran,
      checks: [
        {
          ...first!,
          score: {
            readingLevel: 'hesitant' as const,
            englishLevel: 'words' as const,
            reachedLevel: 'passage' as const,
            wcpm: 37.6,
            uncertain: true,
          },
        },
      ],
    };
    queryClient.setQueryData(pulseCycleQuery(CLASS_ID).queryKey, view([asha, mina, ravi, scored]));
    expect(
      await within(recorded).findByText(
        'Machine: reading hesitant, English single words · 38 words a minute · unsure, please listen',
      ),
    ).toBeInTheDocument();
  });

  it('explains when the month’s children have not been drawn yet', async () => {
    queryClient.setQueryData(pulseCycleQuery(CLASS_ID).queryKey, view([], false));
    renderPage(queryClient);
    expect(await screen.findByText(en.pulse.notStarted.title)).toBeInTheDocument();
  });

  it('explains that Pulse is for Classes 1 to 3', async () => {
    queryClient.setQueryData(classDetailsQuery(CLASS_ID).queryKey, details(5));
    renderPage(queryClient);
    expect(await screen.findByText(en.pulse.notForGrade.title)).toBeInTheDocument();
  });
});
