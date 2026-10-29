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
import { audioConsentQuery, recordAudioConsent } from '@/features/consent/consent-api';
import { deleteDeviceDatabase } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import en from '@/i18n/locales/en.json';
import type * as ItemLevelsModule from './item-levels';
import {
  monthOf,
  pulseCycleQuery,
  type PulseCheckChange,
  type PulseChild,
  type PulseCycleView,
} from './pulse-api';
import { RecordCheckPage } from './record-check-page';
import type * as RecorderModule from './recorder';

const microphone = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  elapsed: 0,
}));

// The reading part's time limit, shortened where a test waits for it.
const limits = vi.hoisted(() => ({ readingMs: 40_000 }));

vi.mock('./item-levels', async (importOriginal) => {
  const actual = await importOriginal<typeof ItemLevelsModule>();
  return {
    ...actual,
    get READING_LIMIT_MS() {
      return limits.readingMs;
    },
  };
});

// The browser's microphone, recorder and audio graph are replaced by a session that records a
// fixed minute of audio.
vi.mock('./recorder', async (importOriginal) => {
  const actual = await importOriginal<typeof RecorderModule>();
  return {
    ...actual,
    MicrophoneSession: {
      open: () => {
        microphone.open();
        return Promise.resolve({
          format: { recorderType: 'audio/webm', contentType: 'audio/webm', extension: 'webm' },
          isInterrupted: false,
          level: () => -45,
          waveform: (bars: number) => Array<number>(bars).fill(0.2),
          measureNoise: () => Promise.resolve(-52.34),
          elapsed: () => microphone.elapsed,
          start: () => undefined,
          stop: () =>
            Promise.resolve({
              blob: new Blob(['voice'], { type: 'audio/webm' }),
              durationMs: 57_500,
              format: { recorderType: 'audio/webm', contentType: 'audio/webm', extension: 'webm' },
            }),
          close: microphone.close,
        });
      },
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));

const CLASS_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const today = todayInIndia();

const asha: PulseChild = {
  sampleId: '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b',
  studentId: '1c9d8d66-7d7f-4a8d-8b5c-3a4b2f6e7d8c',
  name: 'Asha',
  studentCode: '1000000008',
  adapted: false,
  week: 1,
  opensOn: today,
  dueOn: addDays(today, 3),
  replacesSampleId: null,
  replacedAt: null,
  replacementReason: null,
  checks: [],
  absences: [],
};

const sunil: PulseChild = {
  ...asha,
  sampleId: '2dae9e77-8e80-4b9e-9c6d-4b5c3a7f8e9d',
  studentId: '3ebfaf88-9f91-4caf-8d7e-5c6d4b8a9fae',
  name: 'Sunil',
  studentCode: '1000000016',
  adapted: true,
};

const details: ClassDetails = {
  id: CLASS_ID,
  grade: 2,
  section: 'A',
  school: { id: 'school-1', name_en: 'Primary School Rampur', name_hi: null },
};

function renderPage(queryClient: QueryClient, child: PulseChild = asha) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/pulse/$classId/record/$sampleId',
    component: () => (
      <RecordCheckPage classSectionId={CLASS_ID} sampleId={child.sampleId} attempt={1} />
    ),
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/pulse/$classId',
    component: () => <p>Pulse list</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute, listRoute]),
    history: createMemoryHistory({
      initialEntries: [`/app/pulse/${CLASS_ID}/record/${child.sampleId}`],
    }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

async function startRecording() {
  await userEvent.click(await screen.findByRole('button', { name: en.pulse.noise.check }));
  expect(await screen.findByText(en.pulse.noise.quiet)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: en.pulse.startRecording }));
  expect(await screen.findByRole('heading', { name: en.pulse.part.reading })).toBeInTheDocument();
}

async function answerForm() {
  for (const name of [
    en.pulse.form.readingOption.recorded.fluent,
    en.pulse.form.englishOption.sentences,
    en.pulse.form.clarityOption.clear,
    en.pulse.form.classroomOption.normal,
  ]) {
    await userEvent.click(await screen.findByRole('radio', { name }));
  }
  await userEvent.click(screen.getByRole('button', { name: en.pulse.form.save }));
}

async function waitingCheck(): Promise<PulseCheckChange> {
  const waiting = await offlineRuntime.waitingChanges(() => null);
  expect(waiting).toHaveLength(1);
  return waiting[0]?.payload as PulseCheckChange;
}

let queryClient: QueryClient;

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  microphone.open.mockReset();
  microphone.close.mockReset();
  microphone.elapsed = 0;
  limits.readingMs = 40_000;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(classDetailsQuery(CLASS_ID).queryKey, details);
  const view: PulseCycleView = {
    cycle: {
      id: 'cycle-1',
      month: monthOf(today),
      grade: 2,
      language: 'hi',
      firstWeek: 1,
      sampleSize: 20,
      eligibleCount: 30,
    },
    // In draw order; the page counts in the list's order (by name for the same day).
    children: [sunil, asha],
    seenItems: {},
    weeks: [],
  };
  queryClient.setQueryData(pulseCycleQuery(CLASS_ID).queryKey, view);
  sessionStore.set({ status: 'signed-in', userId: 'teacher-1', email: null });
  await offlineRuntime.start('teacher-1', queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
});

describe('recording a check', () => {
  it('records reading, steps down, moves on to English, and keeps what was shown', async () => {
    renderPage(queryClient);
    expect(await screen.findByText(/Week 1 · 1 of 2$/)).toBeInTheDocument();

    // The text appears only once recording starts, and the check cannot be stopped while reading.
    expect(screen.queryByRole('heading', { name: en.pulse.part.reading })).not.toBeInTheDocument();
    await startRecording();
    expect(screen.queryByRole('button', { name: en.pulse.stop })).not.toBeInTheDocument();

    microphone.elapsed = 9_200;
    await userEvent.click(screen.getByRole('button', { name: en.pulse.stepDown.words }));
    expect(screen.getByRole('button', { name: en.pulse.stepDown.letters })).toBeInTheDocument();

    microphone.elapsed = 31_000;
    await userEvent.click(screen.getByRole('button', { name: en.pulse.nextEnglish }));
    expect(await screen.findByRole('heading', { name: en.pulse.part.english })).toBeInTheDocument();
    expect(screen.getByText(en.pulse.speaking.instruction2)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.pulse.nextEnglish })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.pulse.stop }));

    // The form: the microphone is released while the teacher answers.
    expect(await screen.findByText(en.pulse.form.title)).toBeInTheDocument();
    expect(microphone.close).toHaveBeenCalled();

    // Saving asks for every answer first.
    await userEvent.click(screen.getByRole('button', { name: en.pulse.form.save }));
    expect(screen.getAllByText(en.pulse.form.required)).toHaveLength(4);

    for (const name of [
      en.pulse.form.readingOption.recorded.hesitant,
      en.pulse.form.englishOption.words,
      en.pulse.form.clarityOption.clear,
      en.pulse.form.classroomOption.normal,
    ]) {
      await userEvent.click(screen.getByRole('radio', { name }));
    }
    await userEvent.click(screen.getByRole('button', { name: en.pulse.form.tag.missed_words }));
    await userEvent.click(screen.getByRole('button', { name: en.pulse.form.save }));

    expect(await screen.findByText('Pulse list')).toBeInTheDocument();
    const change = await waitingCheck();
    expect(change).toMatchObject({
      mode: 'recorded',
      sampleId: asha.sampleId,
      classSectionId: CLASS_ID,
      attempt: 1,
      durationMs: 57_500,
      noiseDbfs: -52.3,
      readingLevel: 'hesitant',
      englishLevel: 'words',
      clarity: 'clear',
      classroom: 'normal',
      tags: ['missed_words'],
    });
    if (change.mode !== 'recorded') {
      throw new Error('A recorded check was expected.');
    }
    expect(change.itemCode).toMatch(/^hi-g2-p\d\d$/);
    expect(change.promptCode).toMatch(/^en-g2-s\d\d$/);
    expect(change.item).toMatchObject({
      reading: { code: change.itemCode, language: 'hi', grade: 2 },
      speaking: { code: change.promptCode, grade: 2 },
      shown: [
        { level: 'passage', atMs: 0 },
        { level: 'words', atMs: 9_200 },
        { level: 'english', atMs: 31_000 },
      ],
      restarts: 0,
    });
    expect(await (await offlineRuntime.readFile(change.fileId)).text()).toBe('voice');
  });

  it('moves on to English by itself when the reading time is up', async () => {
    limits.readingMs = 300;
    // Set before the recording starts: the shortened timer may fire before the test could set it
    // afterwards. The passage is always shown from the start, whatever the elapsed time says.
    microphone.elapsed = 40_000;
    renderPage(queryClient);
    await startRecording();

    expect(await screen.findByRole('heading', { name: en.pulse.part.english })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.pulse.stop }));
    await answerForm();

    await waitFor(async () => {
      const change = await waitingCheck();
      expect(change.mode === 'recorded' && change.item.shown).toEqual([
        { level: 'passage', atMs: 0 },
        { level: 'english', atMs: 40_000 },
      ]);
    });
  });

  it('records nothing once the family has withdrawn consent', async () => {
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
    expect(await screen.findByText(en.pulse.consentWithdrawn.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.pulse.noise.check })).not.toBeInTheDocument();
    expect(microphone.open).not.toHaveBeenCalled();
  });

  it('records nothing once a withdrawal waits on this phone', async () => {
    // Consent was in force when last fetched; the family withdrew it today, without a network.
    await recordAudioConsent(
      {
        id: '4fc0b099-a0a2-4dba-9e8f-6d7e5c9b0aaf',
        studentId: asha.studentId,
        classSectionId: CLASS_ID,
        granted: false,
        guardianName: 'Guardian',
        method: 'in_person',
        childName: 'Asha',
        classLabel: { grade: 2, section: 'A' },
      },
      queryClient,
    );
    renderPage(queryClient);
    expect(await screen.findByText(en.pulse.consentWithdrawn.title)).toBeInTheDocument();
  });

  it('counts a recording that was started and then abandoned', async () => {
    const first = renderPage(queryClient);
    await startRecording();
    first.unmount();
    expect(microphone.close).toHaveBeenCalled();

    renderPage(queryClient);
    await startRecording();
    await userEvent.click(screen.getByRole('button', { name: en.pulse.nextEnglish }));
    await userEvent.click(await screen.findByRole('button', { name: en.pulse.stop }));
    await answerForm();
    await waitFor(async () => {
      const change = await waitingCheck();
      expect(change.mode === 'recorded' && change.item.restarts).toBe(1);
    });
  });
});

describe('the adapted check', () => {
  it('shows the materials, records nothing, and keeps what the teacher observed', async () => {
    renderPage(queryClient, sunil);
    expect(await screen.findByText(en.pulse.adapted.label)).toBeInTheDocument();
    expect(screen.getByText(/Week 1 · 2 of 2$/)).toBeInTheDocument();
    expect(screen.getByText(en.pulse.adapted.title)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.pulse.part.reading })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.pulse.part.english })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.pulse.noise.check })).not.toBeInTheDocument();

    // The voice and the room are not asked: there is no recording.
    await userEvent.click(screen.getByRole('button', { name: en.pulse.form.save }));
    expect(screen.getAllByText(en.pulse.form.required)).toHaveLength(2);
    expect(
      screen.queryByRole('radio', { name: en.pulse.form.clarityOption.clear }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: en.pulse.stepDown.words }));
    await userEvent.click(
      screen.getByRole('radio', { name: en.pulse.form.readingOption.adapted.hesitant }),
    );
    await userEvent.click(
      screen.getByRole('radio', { name: en.pulse.form.englishOption.no_response }),
    );
    await userEvent.click(screen.getByRole('button', { name: en.pulse.form.tag.needed_prompting }));
    await userEvent.click(screen.getByRole('button', { name: en.pulse.form.save }));

    expect(await screen.findByText('Pulse list')).toBeInTheDocument();
    const change = await waitingCheck();
    expect(change).toEqual({
      mode: 'adapted',
      checkId: expect.any(String) as unknown,
      sampleId: sunil.sampleId,
      classSectionId: CLASS_ID,
      studentId: sunil.studentId,
      readingLevel: 'hesitant',
      englishLevel: 'no_response',
      tags: ['needed_prompting'],
      recordedAt: expect.any(String) as unknown,
      childName: 'Sunil',
      classLabel: { grade: 2, section: 'A' },
    });
    expect(microphone.open).not.toHaveBeenCalled();
  });
});
