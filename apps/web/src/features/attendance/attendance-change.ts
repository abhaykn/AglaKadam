import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { registerChange } from '@/features/offline/change-registry';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import { classLabel } from '@/features/workspaces/grade-label';
import type { AppSupabaseClient } from '@/lib/supabase';
import { formatDay } from './dates';

/**
 * Saving a day's attendance as a change kept on the device: how it is checked, sent, shown and
 * described. It depends on nothing that exists only in a page, so the service worker can send
 * waiting changes with it too, after the application has been closed.
 */

/** Query key of the attendance recorded for a class in the window, by date. */
export function attendanceDaysKey(classSectionId: string) {
  return ['attendance-days', classSectionId] as const;
}

export interface AttendanceDay {
  date: string;
  absentStudentIds: string[];
  enrolledCount: number;
  presentCount: number;
  updatedAt: string;
}

const attendanceChangeSchema = z.object({
  classSectionId: z.guid(),
  date: z.iso.date(),
  absentStudentIds: z.array(z.guid()),
  /** A new identifier for every save, stored with the record it writes. */
  changeId: z.guid(),
  /**
   * Identifiers of this device's earlier saves of the same day that this one replaces. A record
   * written by one of them is the teacher's own older version, not someone else's work.
   */
  supersedes: z.array(z.guid()).max(50),
  /**
   * When the server's record of the day was last changed as the teacher saw it (null when there
   * was none). The change is applied only if the record is still that version, or one of the
   * device's own earlier saves.
   */
  baseUpdatedAt: z.string().nullable(),
  classLabel: z.object({ grade: z.number().int(), section: z.string() }),
});

export type AttendanceChange = z.infer<typeof attendanceChangeSchema>;

/** Error code of a change refused because someone else saved the same day meanwhile. */
export const STALE_ATTENDANCE = 'stale_record';

/** How many earlier saves of a day a new save remembers as its own. */
const SUPERSEDED_LIMIT = 20;

export const SAVED_COLUMNS =
  'attendance_date, absent_student_ids, enrolled_count, present_count, updated_at, client_change_id';

interface SavedRow {
  attendance_date: string;
  absent_student_ids: string[];
  enrolled_count: number;
  present_count: number | null;
  updated_at: string;
  client_change_id: string | null;
}

export function toDay(row: SavedRow): AttendanceDay {
  return {
    date: row.attendance_date,
    absentStudentIds: row.absent_student_ids,
    enrolledCount: row.enrolled_count,
    presentCount: row.present_count ?? row.enrolled_count - row.absent_student_ids.length,
    updatedAt: row.updated_at,
  };
}

/**
 * Sends a day's attendance without ever overwriting someone else's newer record.
 *
 * Any other writer of `attendance_sessions` (an administration tool, a service script) must clear
 * or replace `client_change_id`; otherwise a device could take that writer's version for one of its
 * own earlier saves and write over it.
 *
 * A new day is inserted; an existing day is updated only while it is still the version the
 * teacher started from. When the record has moved on, the identifier stored with it says whose it
 * is: this very save (the answer to an earlier attempt was lost, so it is already done), one of
 * this device's earlier saves of the day (the teacher corrected it again; the newer version goes
 * on top), or someone else's (refused, so the teacher can review it).
 */
export async function sendAttendance(
  change: AttendanceChange,
  supabase: AppSupabaseClient,
): Promise<AttendanceDay> {
  const values = {
    absent_student_ids: change.absentStudentIds,
    client_change_id: change.changeId,
  };

  const insert = async (): Promise<AttendanceDay | null> => {
    const { data, error } = await supabase
      .from('attendance_sessions')
      .insert({ class_section_id: change.classSectionId, attendance_date: change.date, ...values })
      .select(SAVED_COLUMNS)
      .single();
    if (!error) {
      return toDay(data);
    }
    if (error.code === '23505') {
      return null;
    }
    throw error;
  };

  const updateFrom = async (version: string): Promise<AttendanceDay | null> => {
    const { data, error } = await supabase
      .from('attendance_sessions')
      .update(values)
      .eq('class_section_id', change.classSectionId)
      .eq('attendance_date', change.date)
      .eq('updated_at', version)
      .select(SAVED_COLUMNS);
    if (error) {
      throw error;
    }
    const [row] = data;
    return row ? toDay(row) : null;
  };

  const saved =
    change.baseUpdatedAt === null ? await insert() : await updateFrom(change.baseUpdatedAt);
  if (saved) {
    return saved;
  }

  // Someone wrote the day in between; two looks are enough unless it keeps changing.
  for (let look = 0; look < 2; look += 1) {
    const { data: current, error } = await supabase
      .from('attendance_sessions')
      .select(SAVED_COLUMNS)
      .eq('class_section_id', change.classSectionId)
      .eq('attendance_date', change.date)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!current) {
      // The record was removed meanwhile; add the day again.
      const added = await insert();
      if (added) {
        return added;
      }
      continue;
    }
    if (current.client_change_id === change.changeId) {
      return toDay(current);
    }
    if (current.client_change_id !== null && change.supersedes.includes(current.client_change_id)) {
      const rebased = await updateFrom(current.updated_at);
      if (rebased) {
        return rebased;
      }
      continue;
    }
    break;
  }
  throw new ChangeRejectedError(
    STALE_ATTENDANCE,
    'The attendance of this day was changed by someone else after it was opened.',
  );
}

const OWN_SAVES = 'attendance-own-saves';

function ownSavesKey(classSectionId: string) {
  return [OWN_SAVES, classSectionId] as const;
}

/**
 * Remembers, per day, which saves of this device wrote the server's record, so a later save of the
 * same day recognises the record as the teacher's own even when the list of recorded days was never
 * loaded on this device. Kept with the other offline data, encrypted, for as long as it is recent.
 */
export function rememberOwnSave(
  queryClient: QueryClient,
  classSectionId: string,
  date: string,
  changeId: string,
): void {
  queryClient.setQueryDefaults([OWN_SAVES], {
    meta: { persist: true },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  queryClient.setQueryData(
    ownSavesKey(classSectionId),
    (saves: Record<string, string[]> | undefined) => ({
      ...saves,
      [date]: [...(saves?.[date] ?? []), changeId].slice(-SUPERSEDED_LIMIT),
    }),
  );
}

/** This device's saves that wrote the server's record of the day, newest last. */
export function ownSavesOf(
  queryClient: QueryClient,
  classSectionId: string,
  date: string,
): string[] {
  return (
    queryClient.getQueryData<Record<string, string[]>>(ownSavesKey(classSectionId))?.[date] ?? []
  );
}

/** Puts the server's record of a day into the cached list of days, when that list is loaded. */
export function showSavedDay(
  queryClient: QueryClient,
  classSectionId: string,
  day: AttendanceDay,
): void {
  queryClient.setQueryData(
    attendanceDaysKey(classSectionId),
    (days: Record<string, AttendanceDay> | undefined) =>
      days ? { ...days, [day.date]: day } : days,
  );
}

/**
 * The identifiers a new save of a day carries: a fresh one of its own, and those of this device's
 * earlier saves of the day it replaces (sent ones, and the one still waiting, if any).
 */
export function nextSaveIdentity(
  waiting: AttendanceChange | null,
  sentBefore: readonly string[] = [],
): { changeId: string; supersedes: string[] } {
  const earlier = waiting ? [...waiting.supersedes, waiting.changeId] : [];
  return {
    changeId: crypto.randomUUID(),
    supersedes: [...new Set([...sentBefore, ...earlier])].slice(-SUPERSEDED_LIMIT),
  };
}

export const attendanceChange = registerChange<AttendanceChange>({
  kind: 'attendance.save',
  schema: attendanceChangeSchema,
  send: (change, context) => sendAttendance(change, context.supabase),
  // Shows the server's record at once, so the page never falls back to the older one while the
  // list of days is fetched again.
  onSent: (change, result, queryClient) => {
    rememberOwnSave(queryClient, change.classSectionId, change.date, change.changeId);
    showSavedDay(queryClient, change.classSectionId, result as AttendanceDay);
  },
  invalidates: (change) => [attendanceDaysKey(change.classSectionId)],
  describe: (change, t, language) =>
    t('attendance.changeDescription', {
      class: classLabel(t, change.classLabel.grade, change.classLabel.section),
      date: formatDay(change.date, language),
    }),
});
