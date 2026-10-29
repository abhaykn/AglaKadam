import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import { AreaReportSection } from './area-report';
import { areaReportQuery, toAreaReport } from './progress-api';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const MONTHS = ['2026-07-01', '2026-08-01', '2026-09-01'];

function shown(month: string, fluent: number, median: number | null) {
  return {
    month,
    grade: 2,
    language: 'hi',
    withheld: false,
    classes: 6,
    checked: 30,
    needs_support: 10,
    hesitant: 20 - fluent,
    fluent,
    independent: 15,
    speed: median === null ? null : { timed: 20, median_wcpm: median, at_lakshya: 5, lakshya: 45 },
  };
}

describe("an office's report", () => {
  it('shows each class and medium over finished months, and holds back small groups', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const report = toAreaReport({
      fewest_classes: 5,
      fewest_schools: 3,
      fewest_crps: 2,
      last_month: '2026-09-01',
      schools: 9,
      classes: 30,
      coaching: MONTHS.map((month, index) => ({
        month,
        visits_done: index === 2 ? null : { visits: 12, classes: 8 },
        follow_ups: { practised: 4 + index, partly: 2, not_yet: 2 },
        feedback_score: null,
        time_to_feedback: { median_minutes: 20 },
      })),
      pulse: [
        shown('2026-07-01', 5, 30),
        { month: '2026-08-01', grade: 2, language: 'hi', withheld: true },
        shown('2026-09-01', 8, 41),
        { month: '2026-09-01', grade: 1, language: 'en', withheld: true },
      ],
    });
    queryClient.setQueryData(areaReportQuery().queryKey, report);
    render(
      <QueryClientProvider client={queryClient}>
        <AreaReportSection />
      </QueryClientProvider>,
    );

    // One part for each class and medium, in class order.
    const headings = (await screen.findAllByRole('heading', { level: 3 })).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(['Class 1, English medium', 'Class 2, Hindi medium']);
    expect(
      screen.getByText(/Every month here comes from fewer than 5 classes or 3 schools/),
    ).toBeInTheDocument();

    // The held-back month keeps its place, shown as not shown.
    const speed = screen.getByRole('figure', { name: en.progress.area.speedTitle });
    expect(
      within(speed).getByRole('img', { name: `Aug: ${en.progress.area.withheld}` }),
    ).toBeTruthy();
    expect(within(speed).getByRole('img', { name: 'Sept: 41 words a minute' })).toBeTruthy();
    // A line joins only neighbouring months with figures.
    expect(speed.querySelectorAll('polyline')).toHaveLength(0);
    expect(
      screen.getByText(/1 month is not shown: it comes from fewer than 5 classes or 3 schools/),
    ).toBeInTheDocument();
    expect(screen.getByText(/25% read 45 words a minute or more/)).toBeInTheDocument();

    // The last month's visits came from too few to show.
    expect(screen.getByText('Sept 2026: too few visits to show.')).toBeInTheDocument();
    expect(
      screen.getByText(/at least 5 classes in 3 schools \(and, for mentoring, 2 CRPs/),
    ).toBeTruthy();
  });

  it('starts at the first month the area has any record of', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const empty = {
      visits_done: null,
      follow_ups: null,
      feedback_score: null,
      time_to_feedback: null,
    };
    const report = toAreaReport({
      fewest_classes: 5,
      fewest_schools: 3,
      fewest_crps: 2,
      last_month: '2026-09-01',
      schools: 9,
      classes: 30,
      coaching: [
        { month: '2026-07-01', ...empty },
        { month: '2026-08-01', ...empty, time_to_feedback: { median_minutes: 30 } },
        { month: '2026-09-01', ...empty, time_to_feedback: { median_minutes: 20 } },
      ],
      pulse: [],
    });
    queryClient.setQueryData(areaReportQuery().queryKey, report);
    render(
      <QueryClientProvider client={queryClient}>
        <AreaReportSection />
      </QueryClientProvider>,
    );
    const minutes = await screen.findByRole('figure', { name: en.progress.area.minutes });
    expect(within(minutes).getAllByRole('img')).toHaveLength(2);
    expect(within(minutes).queryByRole('img', { name: /^Jul/ })).toBeNull();
    expect(within(minutes).getByRole('img', { name: 'Aug: 30 minutes' })).toBeTruthy();
  });
});
