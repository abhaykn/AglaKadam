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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayInIndia } from '@shared/accounts.ts';
import { AccessContext } from '@/features/app-shell/access-context';
import {
  classDetailsQuery,
  classRosterQuery,
  type ClassDetails,
  type RosterEntry,
} from '@/features/attendance/attendance-api';
import type { Access } from '@/features/auth/access';
import { sessionStore } from '@/features/auth/session';
import { deleteDeviceDatabase, DeviceStore } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import { marksDraftKey, type MarksChange } from './exam-change';
import { classExamsQuery, paperMarksQuery, type ClassPaper, type PaperMarks } from './exam-api';
import { MarksPage } from './marks-page';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const TEACHER = '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c2';
const CLASS = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SCHOOL = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9';
const EXAM = '0f1e2d3c-4b5a-4968-8776-655443322110';
const PAPER = '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b';
const CHILDREN = [
  { id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c01', name: 'Asha' },
  { id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c02', name: 'Bilal' },
  { id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c03', name: 'Chetan' },
];
const today = todayInIndia();

const access: Access = {
  user_id: TEACHER,
  account_kind: 'staff',
  full_name: 'Meena Devi',
  preferred_language: 'en',
  phone: null,
  is_active: true,
  password_change_required: false,
  assignments: [
    {
      id: 'assignment-1',
      role: 'teacher',
      starts_on: '2026-04-01',
      ends_on: null,
      scope: { type: 'school', id: SCHOOL, code: '09010100101', name_en: 'Rampur', name_hi: null },
    },
  ],
  student: null,
};

function paper(overrides: Partial<ClassPaper> = {}): ClassPaper {
  return {
    id: PAPER,
    examId: EXAM,
    classSectionId: CLASS,
    schoolId: SCHOOL,
    subject: 'hindi',
    subjectName: null,
    heldOn: today,
    scale: 'marks',
    maxMarks: 20,
    revision: 2,
    clientChangeId: null,
    results: 0,
    exam: {
      id: EXAM,
      academicYearId: '0a1b2c3d-4e5f-4061-8273-a4b5c6d7e8f9',
      kind: 'class_test',
      title: '',
      clusterId: null,
      schoolId: SCHOOL,
      startsOn: today,
      endsOn: today,
      createdBy: TEACHER,
    },
    ...overrides,
  };
}

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/exams/$classId/paper/$paperId',
    component: () => <MarksPage classSectionId={CLASS} paperId={PAPER} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/exams/${CLASS}/paper/${PAPER}`] }),
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

async function waitingMarks(): Promise<MarksChange | null> {
  const entry = await offlineRuntime.waitingEntry(`exam-marks:${PAPER}`);
  return entry ? (entry.payload as MarksChange) : null;
}

let queryClient: QueryClient;

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const details: ClassDetails = {
    id: CLASS,
    grade: 2,
    section: 'A',
    school: { id: SCHOOL, name_en: 'Primary School Rampur', name_hi: null },
  };
  const roster: RosterEntry[] = CHILDREN.map((child, index) => ({
    studentId: child.id,
    fullName: child.name,
    studentCode: `RAM-${String(index + 1)}`,
    enrolledOn: '2026-04-01',
    endedOn: null,
  }));
  queryClient.setQueryData(classDetailsQuery(CLASS).queryKey, details);
  queryClient.setQueryData(classRosterQuery(CLASS).queryKey, roster);
  queryClient.setQueryData(classExamsQuery(CLASS).queryKey, [paper()]);
  const noMarks: PaperMarks = { revision: 2, clientChangeId: null, marks: [] };
  queryClient.setQueryData(paperMarksQuery(PAPER).queryKey, noMarks);
  sessionStore.set({ status: 'signed-in', userId: TEACHER, email: null });
  await offlineRuntime.start(TEACHER, queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('entering marks', () => {
  it('stops marks above the maximum, then keeps the paper on the phone', async () => {
    renderPage(queryClient);
    const asha = await screen.findByLabelText('Marks of Asha');
    await userEvent.type(asha, '21');
    // The slip is pointed out once the field is left, not while typing.
    expect(screen.queryByText('More than the maximum of 20.')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByText('More than the maximum of 20.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.exams.marks.save }));
    expect(await screen.findByText(en.exams.marks.fixProblems)).toBeInTheDocument();
    expect(await waitingMarks()).toBeNull();

    await userEvent.clear(asha);
    await userEvent.type(asha, '17.5');
    await userEvent.click(screen.getByRole('button', { name: 'Absent: Bilal' }));
    await userEvent.click(screen.getByRole('button', { name: en.exams.marks.save }));

    await waitFor(async () => {
      const change = await waitingMarks();
      expect(change).toMatchObject({ paperId: PAPER, baseRevision: 2, supersedes: [] });
      expect(change?.entries).toEqual([
        { studentId: CHILDREN[0]?.id, marks: 17.5, grade: null, absent: false },
        { studentId: CHILDREN[1]?.id, marks: null, grade: null, absent: true },
      ]);
    });
    expect(await screen.findByText(en.exams.save.waiting)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 entered/)).toBeInTheDocument();
  });

  it('sends back unchanged the marks of a child who has left the class', async () => {
    const left = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c09';
    const held: PaperMarks = {
      revision: 2,
      clientChangeId: null,
      marks: [
        {
          studentId: left,
          marks: 12,
          grade: null,
          absent: false,
          updatedAt: '2026-10-01T05:00:00.000Z',
        },
      ],
    };
    queryClient.setQueryData(paperMarksQuery(PAPER).queryKey, held);
    renderPage(queryClient);
    await userEvent.type(await screen.findByLabelText('Marks of Asha'), '15');
    await userEvent.click(screen.getByRole('button', { name: en.exams.marks.save }));
    await waitFor(async () => {
      const change = await waitingMarks();
      expect(change?.entries).toEqual([
        { studentId: CHILDREN[0]?.id, marks: 15, grade: null, absent: false },
        { studentId: left, marks: 12, grade: null, absent: false },
      ]);
    });
  });

  it('marks a paper without results that was never opened with a network', async () => {
    queryClient.setQueryData(classExamsQuery(CLASS).queryKey, [paper({ revision: 0, results: 0 })]);
    queryClient.removeQueries({ queryKey: paperMarksQuery(PAPER).queryKey });
    renderPage(queryClient);
    await userEvent.type(await screen.findByLabelText('Marks of Bilal'), '8');
    await userEvent.click(screen.getByRole('button', { name: en.exams.marks.save }));
    await waitFor(async () => {
      expect(await waitingMarks()).toMatchObject({ baseRevision: 0 });
    });
  });

  it('keeps the marks of a refused save in front of the teacher, to correct and save again', async () => {
    renderPage(queryClient);
    await userEvent.type(await screen.findByLabelText('Marks of Asha'), '14');
    await userEvent.click(screen.getByRole('button', { name: en.exams.marks.save }));
    await waitFor(async () => {
      expect(await waitingMarks()).not.toBeNull();
    });
    // The server refuses the save for a reason the teacher can act on.
    const store = await DeviceStore.open();
    try {
      const entry = await store.outboxEntryByDedupeKey(TEACHER, `exam-marks:${PAPER}`);
      await store.updateOutboxEntry(entry?.id ?? '', null, {
        state: 'failed',
        attempts: 1,
        lastError: { code: 'P0001', message: "Marks are entered by the school's teachers." },
      });
    } finally {
      store.close();
    }
    // After a refusal the page reads the marks the server still holds: none.
    queryClient.setQueryData<PaperMarks>(paperMarksQuery(PAPER).queryKey, {
      revision: 2,
      clientChangeId: null,
      marks: [],
    });
    await offlineRuntime.refreshStatus(true);
    expect(await screen.findByText(en.exams.refused.teachersOnly)).toBeInTheDocument();
    expect(screen.getByLabelText('Marks of Asha')).toHaveValue('14');
  });

  it('brings back marks typed earlier and not saved', async () => {
    queryClient.setQueryData(marksDraftKey(PAPER), {
      [CHILDREN[2]?.id ?? '']: { text: '9', grade: null, absent: false },
    });
    renderPage(queryClient);
    expect(await screen.findByText(en.exams.marks.restored)).toBeInTheDocument();
    expect(screen.getByLabelText('Marks of Chetan')).toHaveValue('9');
  });

  it('waits for the day of the paper', async () => {
    queryClient.setQueryData(classExamsQuery(CLASS).queryKey, [paper({ heldOn: '2999-01-01' })]);
    renderPage(queryClient);
    expect(await screen.findByLabelText('Marks of Asha')).toBeDisabled();
    expect(screen.queryByRole('button', { name: en.exams.marks.save })).not.toBeInTheDocument();
  });
});
