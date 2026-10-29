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
import jsQR from 'jsqr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayInIndia } from '@shared/accounts.ts';
import { addDays } from '@/features/attendance/dates';
import en from '@/i18n/locales/en.json';
import { CrpCodesPage } from './crp-codes-page';
import { pulseWeekCodesQuery, type WeekCode } from './pulse-api';
import { readWeekUnlockCode } from './week-batch';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const today = todayInIndia();
const KEY = 'a1'.repeat(32);

const rampur = { id: 'school-1', name_en: 'Primary School Rampur', name_hi: null };
const sitapur = { id: 'school-2', name_en: 'Primary School Sitapur', name_hi: null };

const rampurWeek2: WeekCode = {
  cycleId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  week: 2,
  opensOn: today,
  key: `\\x${KEY}`,
  classLabel: { grade: 2, section: 'A' },
  school: rampur,
};

const codes: WeekCode[] = [
  rampurWeek2,
  {
    cycleId: '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b',
    week: 1,
    opensOn: `${today.slice(0, 7)}-01`,
    key: 'b2'.repeat(32),
    classLabel: { grade: 3, section: 'B' },
    school: sitapur,
  },
  // Released early to the CRP, but not yet open: no code is shown for it.
  {
    cycleId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    week: 3,
    opensOn: addDays(today, 7),
    key: 'c3'.repeat(32),
    classLabel: { grade: 2, section: 'A' },
    school: rampur,
  },
];

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function renderPage(queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: Outlet });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/crp/pulse-codes',
    component: CrpCodesPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ['/app/crp/pulse-codes'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is not the registered application router. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

/** Reads a drawn QR code back with the decoder teachers' phones use when the browser has none. */
function decodeDrawnCode(svg: Element): string | null {
  const size = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
  const scale = 4;
  const width = size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  const path = svg.querySelector('path')?.getAttribute('d') ?? '';
  for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const column = Number(match[1]);
    const row = Number(match[2]);
    for (let y = row * scale; y < (row + 1) * scale; y += 1) {
      for (let x = column * scale; x < (column + 1) * scale; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
      }
    }
  }
  return jsQR(pixels, width, width)?.data ?? null;
}

let queryClient: QueryClient;

beforeEach(() => {
  setOnline(true);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('the CRP’s unlock codes', () => {
  it('lists the opened weeks by school and shows a code a teacher’s phone can read', async () => {
    queryClient.setQueryData(pulseWeekCodesQuery().queryKey, codes);
    renderPage(queryClient);

    expect(await screen.findByText(en.pulse.codes.howTo)).toBeInTheDocument();
    expect(screen.getByText('Primary School Rampur')).toBeInTheDocument();
    expect(screen.getByText('Primary School Sitapur')).toBeInTheDocument();
    expect(screen.getByText('Class 2 – A · Week 2')).toBeInTheDocument();
    expect(screen.getByText('Class 3 – B · Week 1')).toBeInTheDocument();
    expect(screen.queryByText('Class 2 – A · Week 3')).not.toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: en.pulse.codes.show });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Class 2 – A · week 2')).toBeInTheDocument();
    const drawn = within(dialog).getByRole('img', { name: en.pulse.codes.qrLabel });
    expect(readWeekUnlockCode(decodeDrawnCode(drawn) ?? '')).toEqual({
      cycleId: rampurWeek2.cycleId,
      week: 2,
      keyHex: KEY,
    });
  });

  it('lists this month\u2019s weeks only, when codes of two months are kept', async () => {
    const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1);
    queryClient.setQueryData(pulseWeekCodesQuery().queryKey, [
      // Kept from last month, with the same class and week number as this month's.
      {
        ...rampurWeek2,
        cycleId: '1c9d8d66-7d7f-4a8d-8b5c-3a4b2f6e7d8c',
        opensOn: lastMonth,
        key: 'd4'.repeat(32),
      },
      ...codes,
    ]);
    renderPage(queryClient);
    expect(await screen.findByText(en.pulse.codes.howTo)).toBeInTheDocument();
    expect(screen.getAllByText('Class 2 – A · Week 2')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: en.pulse.codes.show })).toHaveLength(2);
  });

  it('explains when no week of the cluster has opened', async () => {
    queryClient.setQueryData(pulseWeekCodesQuery().queryKey, codes.slice(2));
    renderPage(queryClient);
    expect(await screen.findByText(en.pulse.codes.empty.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.pulse.codes.show })).not.toBeInTheDocument();
  });

  it('explains that the codes must be fetched once with a network', async () => {
    setOnline(false);
    renderPage(queryClient);
    expect(await screen.findByText(en.pulse.codes.notOnDevice.title)).toBeInTheDocument();
  });
});
