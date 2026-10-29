import { useCallback, useState } from 'react';
import { addDays } from '@/features/attendance/dates';
import { readLocal, writeLocal } from '@/lib/local-storage';

/**
 * Stars a child earns while practising, kept only on this phone: practice is for the child and the
 * family, and nothing of it is sent to the school. Only the last 60 days are kept.
 */

/** Stars earned on each day, by `YYYY-MM-DD`. */
export type PracticeDays = Record<string, number>;

const KEPT_DAYS = 60;

const storageKey = (studentId: string) => `agla:practice:${studentId}`;

export function readPracticeDays(studentId: string): PracticeDays {
  const stored = readLocal(storageKey(studentId));
  if (!stored) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const days: PracticeDays = {};
    for (const [day, stars] of Object.entries(parsed)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof stars === 'number' && stars > 0) {
        days[day] = Math.floor(stars);
      }
    }
    return days;
  } catch {
    return {};
  }
}

/** The days with one more star today, without days older than 60 days. */
export function withStar(days: PracticeDays, today: string): PracticeDays {
  const oldest = addDays(today, -KEPT_DAYS);
  const kept: PracticeDays = {};
  for (const [day, stars] of Object.entries(days)) {
    if (day > oldest && day <= today) {
      kept[day] = stars;
    }
  }
  kept[today] = (kept[today] ?? 0) + 1;
  return kept;
}

export interface PracticeSummary {
  today: number;
  /** Days of the last seven, today included, with at least one star. */
  daysThisWeek: number;
  /** Days in a row with practice, up to today or yesterday. */
  run: number;
}

export function summarisePractice(days: PracticeDays, today: string): PracticeSummary {
  let daysThisWeek = 0;
  for (let back = 0; back < 7; back += 1) {
    if ((days[addDays(today, -back)] ?? 0) > 0) {
      daysThisWeek += 1;
    }
  }
  // A run is not broken before the child has practised today.
  let day = (days[today] ?? 0) > 0 ? today : addDays(today, -1);
  let run = 0;
  while ((days[day] ?? 0) > 0) {
    run += 1;
    day = addDays(day, -1);
  }
  return { today: days[today] ?? 0, daysThisWeek, run };
}

/** The child's practice days on this phone, and a way to add a star. */
export function usePracticeDays(studentId: string, today: string) {
  const [days, setDays] = useState(() => readPracticeDays(studentId));
  const addStar = useCallback(() => {
    setDays((current) => {
      const next = withStar(current, today);
      writeLocal(storageKey(studentId), JSON.stringify(next));
      return next;
    });
  }, [studentId, today]);
  return { days, addStar };
}
