/**
 * A child's attendance, summarised for the family: the days attendance was taken in each month,
 * those the child was present, and the run of present days up to the latest record. Days without
 * a record (holidays, or days the teacher did not mark) are not counted either way.
 */

export interface AttendanceDay {
  date: string;
  present: boolean;
}

export interface MonthAttendance {
  /** `YYYY-MM`. */
  month: string;
  marked: number;
  present: number;
  /** The days the child was absent, in order. */
  absentDays: string[];
}

export interface AttendanceSummary {
  months: MonthAttendance[];
  marked: number;
  present: number;
  /** Share of the marked days the child was present, in whole percent; null without records. */
  percent: number | null;
  /** Present days in a row, counted back from the latest marked day. */
  streak: number;
  latest: string | null;
}

/** The first day of the academic session (April to March) a day falls in. */
export function sessionStart(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return `${String(month >= 4 ? year : year - 1)}-04-01`;
}

/** The months of the summary are the latest first. */
export function summariseAttendance(days: readonly AttendanceDay[]): AttendanceSummary {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const months = new Map<string, MonthAttendance>();
  for (const day of ordered) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) ?? { month: key, marked: 0, present: 0, absentDays: [] };
    month.marked += 1;
    if (day.present) {
      month.present += 1;
    } else {
      month.absentDays.push(day.date);
    }
    months.set(key, month);
  }
  let streak = 0;
  for (let index = ordered.length - 1; index >= 0 && ordered[index]?.present; index -= 1) {
    streak += 1;
  }
  const present = ordered.filter((day) => day.present).length;
  return {
    months: [...months.values()].reverse(),
    marked: ordered.length,
    present,
    percent: ordered.length > 0 ? Math.round((present * 100) / ordered.length) : null,
    streak,
    latest: ordered.at(-1)?.date ?? null,
  };
}

/** The share of a month's marked days the child was present, in whole percent. */
export function monthPercent(month: MonthAttendance): number {
  return month.marked > 0 ? Math.round((month.present * 100) / month.marked) : 0;
}
