import { describe, expect, it } from 'vitest';
import { addDays, dayInIndia, isCalendarDate } from './dates';

describe('calendar dates', () => {
  it('reads the day in India of a recorded moment', () => {
    // Half past one in the morning of 21 October in India is still 20 October in UTC.
    expect(dayInIndia('2026-10-20T20:00:00.000Z')).toBe('2026-10-21');
    expect(dayInIndia('2026-10-20T18:29:59+00:00')).toBe('2026-10-20');
    expect(dayInIndia('2026-10-21T09:00:00+05:30')).toBe('2026-10-21');
  });

  it('counts days across months and checks dates', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
  });
});
