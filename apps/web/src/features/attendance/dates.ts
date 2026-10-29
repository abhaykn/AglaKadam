import { todayInIndia } from '@shared/accounts.ts';

/** Calendar dates as `YYYY-MM-DD` strings, with arithmetic that ignores time zones. */

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * The day in India of a moment recorded as a timestamp. The timestamp's own date is the day in UTC,
 * which is still the day before until half past five in the morning in India.
 */
export function dayInIndia(timestamp: string): string {
  return todayInIndia(new Date(timestamp));
}

export function addDays(date: string, days: number): string {
  const value = parse(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parse(value).getTime()) &&
    parse(value).toISOString().slice(0, 10) === value
  );
}

/** A date for people to read, such as "Sat, 18 Oct" or "शनि, 18 अक्टू॰". */
export function formatDay(date: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parse(date));
}
