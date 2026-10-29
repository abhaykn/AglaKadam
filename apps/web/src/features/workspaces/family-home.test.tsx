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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayInIndia } from '@shared/accounts.ts';
import { AccessContext } from '@/features/app-shell/access-context';
import { addDays } from '@/features/attendance/dates';
import type { Access } from '@/features/auth/access';
import { classNotesQuery, type ClassNote } from '@/features/class-notes/note-api';
import { familyAttendanceQuery, familyResultsQuery } from '@/features/family/family-api';
import { childExams } from '@/features/family/results';
import en from '@/i18n/locales/en.json';
import { FamilyHome } from './family-home';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const STUDENT = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c01';
const CLASS = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const today = todayInIndia();

const access: Access = {
  user_id: '9b8a7c6d-5e4f-4321-8a9b-0c1d2e3f4a5b',
  account_kind: 'student',
  full_name: 'Asha Kumari',
  preferred_language: 'en',
  phone: null,
  is_active: true,
  password_change_required: false,
  assignments: [],
  student: {
    id: STUDENT,
    full_name: 'Asha Kumari',
    student_code: 'RAM-2026-0001',
    school: { id: '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9', name_en: 'Rampur', name_hi: null },
    class: { id: CLASS, grade: 2, section: 'A' },
  },
};

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/family',
    component: FamilyHome,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ['/app/family'] }),
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

let queryClient: QueryClient;

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const exam = {
    id: '2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901',
    kind: 'unit_test' as const,
    title: '',
    startsOn: addDays(today, -10),
    endsOn: addDays(today, -8),
  };
  queryClient.setQueryData(
    familyResultsQuery(STUDENT).queryKey,
    childExams([
      {
        paperId: '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a01',
        subject: 'hindi',
        subjectName: null,
        heldOn: exam.startsOn,
        scale: 'marks',
        maxMarks: 20,
        marks: 17,
        grade: null,
        absent: false,
        exam,
      },
      {
        paperId: '3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a02',
        subject: 'maths',
        subjectName: null,
        heldOn: exam.endsOn,
        scale: 'marks',
        maxMarks: 20,
        marks: 3,
        grade: null,
        absent: false,
        exam,
      },
    ]),
  );
  queryClient.setQueryData(familyAttendanceQuery(STUDENT).queryKey, [
    { date: today, present: true },
  ]);
  const notes: ClassNote[] = [
    {
      id: '0f1e2d3c-4b5a-4968-8776-655443322110',
      classSectionId: CLASS,
      kind: 'homework',
      body: 'Learn the table of 4.',
      dueOn: addDays(today, 2),
      attachment: null,
      authorId: null,
      authorName: 'Meena Devi',
      createdAt: new Date().toISOString(),
    },
  ];
  queryClient.setQueryData(classNotesQuery(CLASS).queryKey, notes);
});

describe("the family's page", () => {
  it("shows the teacher's homework, attendance and shared results with stars", async () => {
    renderPage(queryClient);
    expect(await screen.findByText('Learn the table of 4.')).toBeInTheDocument();
    expect(screen.getByText(en.notes.kind.homework)).toBeInTheDocument();
    // A family reads notes; removing them is for the teachers.
    expect(screen.queryByRole('button', { name: en.notes.remove })).not.toBeInTheDocument();

    expect(screen.getAllByText('1 of 1 days').length).toBeGreaterThan(0);
    expect(screen.getByText('100% present')).toBeInTheDocument();

    const results = screen.getByRole('table', { name: 'Results in Unit test' });
    const hindi = within(results).getByRole('row', { name: /Hindi/ });
    expect(within(hindi).getByText('17/20')).toBeInTheDocument();
    expect(within(hindi).getByRole('img', { name: '5 stars of 5' })).toBeInTheDocument();
    const maths = within(results).getByRole('row', { name: /Maths/ });
    expect(within(maths).getByRole('img', { name: '1 star of 5' })).toBeInTheDocument();
    expect(screen.getByText(/Some practice at home will help in Maths/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: en.family.practice.open }).length).toBeGreaterThan(
      0,
    );
  });
});
