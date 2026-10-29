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
import { classDetailsQuery, type ClassDetails } from '@/features/attendance/attendance-api';
import { addDays } from '@/features/attendance/dates';
import { sessionStore } from '@/features/auth/session';
import { deleteDeviceDatabase } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import { ClassNotesPage } from './class-notes-page';
import { classNotesQuery, type ClassNote } from './note-api';
import { noteSendChange, type NoteSendChange } from './note-change';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const TEACHER = '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c2';
const CLASS = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SCHOOL = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9';

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/notes/$classId',
    component: () => <ClassNotesPage classSectionId={CLASS} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [`/app/notes/${CLASS}`] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

async function waitingNotes(): Promise<NoteSendChange[]> {
  const changes = await offlineRuntime.waitingChanges(() => null);
  return changes
    .filter((change) => change.kind === noteSendChange.kind)
    .map((change) => change.payload as NoteSendChange);
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
  const sent: ClassNote[] = [
    {
      id: '0f1e2d3c-4b5a-4968-8776-655443322110',
      classSectionId: CLASS,
      kind: 'message',
      body: 'The school is closed on Friday for the festival.',
      dueOn: null,
      attachment: null,
      authorId: TEACHER,
      authorName: 'Meena Devi',
      createdAt: '2026-10-20T04:30:00.000Z',
    },
  ];
  queryClient.setQueryData(classDetailsQuery(CLASS).queryKey, details);
  queryClient.setQueryData(classNotesQuery(CLASS).queryKey, sent);
  sessionStore.set({ status: 'signed-in', userId: TEACHER, email: null });
  await offlineRuntime.start(TEACHER, queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('notes to families', () => {
  it('keeps homework with its PDF on the phone and shows it as waiting', async () => {
    const { container } = renderPage(queryClient);
    expect(
      await screen.findByText('The school is closed on Friday for the festival.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: en.notes.kind.homework }));
    await userEvent.type(
      screen.getByLabelText(en.notes.write.homeworkBody),
      'Read page 12 aloud to someone at home.',
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('No file input.');
    }
    await userEvent.upload(
      input,
      new File(['%PDF-1.7'], 'Page 12.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText('Page 12.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.notes.write.send }));

    await waitFor(async () => {
      expect(await waitingNotes()).toEqual([
        expect.objectContaining({
          classSectionId: CLASS,
          schoolId: SCHOOL,
          kind: 'homework',
          body: 'Read page 12 aloud to someone at home.',
          dueOn: addDays(todayInIndia(), 1),
          file: expect.objectContaining({
            contentType: 'application/pdf',
            name: 'Page 12.pdf',
            bytes: 8,
          }) as unknown,
        }),
      ]);
    });
    expect(await screen.findByText(en.notes.status.waiting)).toBeInTheDocument();
    // The form is ready for the next note.
    expect(screen.getByLabelText(en.notes.write.body)).toHaveValue('');

    const [note] = await waitingNotes();
    const stored = await offlineRuntime.readFile(note?.file?.fileId ?? '');
    expect(await stored.text()).toBe('%PDF-1.7');
  });

  it('asks for the text before sending, and refuses files other than photos and PDFs', async () => {
    const { container } = renderPage(queryClient);
    await userEvent.click(await screen.findByRole('button', { name: en.notes.write.send }));
    expect(await screen.findByText(en.notes.write.bodyRequired)).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('No file input.');
    }
    await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }), {
      applyAccept: false,
    });
    expect(await screen.findByText(en.notes.write.fileProblem.type)).toBeInTheDocument();
    expect(await waitingNotes()).toEqual([]);
  });

  it('removes a waiting note when it is discarded', async () => {
    renderPage(queryClient);
    await userEvent.type(
      await screen.findByLabelText(en.notes.write.body),
      'Parents meeting at 10.',
    );
    await userEvent.click(screen.getByRole('button', { name: en.notes.write.send }));
    expect(await screen.findByText(en.notes.status.waiting)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.notes.discard }));
    await waitFor(async () => {
      expect(await waitingNotes()).toEqual([]);
    });
    await waitFor(() => {
      expect(screen.queryByText('Parents meeting at 10.')).not.toBeInTheDocument();
    });
  });
});
