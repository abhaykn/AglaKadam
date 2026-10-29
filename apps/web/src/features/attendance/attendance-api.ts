import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { todayInIndia } from '@shared/accounts.ts';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { getSupabase } from '@/lib/supabase';
import {
  attendanceChange,
  attendanceDaysKey,
  rememberOwnSave,
  SAVED_COLUMNS,
  sendAttendance,
  showSavedDay,
  toDay,
  type AttendanceChange,
  type AttendanceDay,
} from './attendance-change';
import { addDays } from './dates';

export {
  attendanceChange,
  nextSaveIdentity,
  ownSavesOf,
  STALE_ATTENDANCE,
  type AttendanceChange,
  type AttendanceDay,
} from './attendance-change';

/**
 * Daily class attendance, marked on the device and sent when a network is available.
 *
 * Teachers may mark and correct the last {@link ATTENDANCE_WINDOW_DAYS} days. The database accepts
 * a new record up to 31 days late, so a change saved offline within the window is still accepted
 * when the device only syncs weeks later.
 */

export const ATTENDANCE_WINDOW_DAYS = 7;
/** Enrolments that ended this long ago no longer affect any day that can be marked. */
const ROSTER_HISTORY_DAYS = 31;

export interface ClassDetails {
  id: string;
  grade: number;
  section: string;
  school: { id: string; name_en: string; name_hi: string | null };
}

export function classDetailsQuery(classSectionId: string) {
  return queryOptions({
    queryKey: ['class-section', classSectionId],
    meta: { persist: true },
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<ClassDetails | null> => {
      const { data, error } = await getSupabase()
        .from('class_sections')
        .select('id, grade, section, schools!inner(id, name_en, name_hi)')
        .eq('id', classSectionId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data
        ? { id: data.id, grade: data.grade, section: data.section, school: data.schools }
        : null;
    },
  });
}

export interface RosterEntry {
  studentId: string;
  fullName: string;
  studentCode: string;
  enrolledOn: string;
  endedOn: string | null;
}

/**
 * Everyone enrolled in the class recently, with their enrolment dates, so that the roll of any day
 * in the window can be worked out on the device without a network.
 */
export function classRosterQuery(classSectionId: string) {
  return queryOptions({
    queryKey: ['class-roster', classSectionId],
    meta: { persist: true },
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<RosterEntry[]> => {
      const since = addDays(todayInIndia(), -ROSTER_HISTORY_DAYS);
      const { data, error } = await getSupabase()
        .from('enrolments')
        .select('enrolled_on, ended_on, students!inner(id, full_name, student_code)')
        .eq('class_section_id', classSectionId)
        .or(`ended_on.is.null,ended_on.gte.${since}`);
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        studentId: row.students.id,
        fullName: row.students.full_name,
        studentCode: row.students.student_code,
        enrolledOn: row.enrolled_on,
        endedOn: row.ended_on,
      }));
    },
  });
}

/** The children on the class roll on `date`, as the database counts them. */
export function rollOn(roster: RosterEntry[], date: string): RosterEntry[] {
  const seen = new Set<string>();
  return roster
    .filter(
      (entry) => entry.enrolledOn <= date && (entry.endedOn === null || entry.endedOn >= date),
    )
    .filter((entry) => {
      if (seen.has(entry.studentId)) {
        return false;
      }
      seen.add(entry.studentId);
      return true;
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'hi'));
}

/** Attendance already recorded for the class in the window, by date. */
export function attendanceDaysQuery(classSectionId: string) {
  return queryOptions({
    queryKey: attendanceDaysKey(classSectionId),
    meta: { persist: true },
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Record<string, AttendanceDay>> => {
      const since = addDays(todayInIndia(), -ATTENDANCE_WINDOW_DAYS);
      const { data, error } = await getSupabase()
        .from('attendance_sessions')
        .select(SAVED_COLUMNS)
        .eq('class_section_id', classSectionId)
        .gte('attendance_date', since);
      if (error) {
        throw error;
      }
      return Object.fromEntries(data.map((row) => [row.attendance_date, toDay(row)]));
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

export function attendanceDedupeKey(classSectionId: string, date: string): string {
  return `attendance:${classSectionId}:${date}`;
}

/**
 * Saves a day's attendance. It is kept on the device first and sent in the background, and
 * `queued` is then true. When the device cannot keep it (storage blocked or full), it is sent
 * directly instead, which needs a connection; the page then shows the server's answer at once.
 */
export async function saveAttendance(
  change: AttendanceChange,
  queryClient: QueryClient,
): Promise<{ queued: boolean }> {
  if (offlineRuntime.isAvailable) {
    try {
      await offlineRuntime.enqueue(
        attendanceChange.kind,
        change,
        attendanceDedupeKey(change.classSectionId, change.date),
      );
      return { queued: true };
    } catch (error) {
      if (!navigator.onLine) {
        throw error;
      }
    }
  }
  try {
    const day = await sendAttendance(change, getSupabase());
    rememberOwnSave(queryClient, change.classSectionId, change.date, change.changeId);
    showSavedDay(queryClient, change.classSectionId, day);
    return { queued: false };
  } finally {
    void queryClient.invalidateQueries({ queryKey: attendanceDaysKey(change.classSectionId) });
  }
}
