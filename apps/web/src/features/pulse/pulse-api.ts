import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { todayInIndia } from '@shared/accounts.ts';
import { classRosterQuery } from '@/features/attendance/attendance-api';
import { addDays } from '@/features/attendance/dates';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { getSupabase } from '@/lib/supabase';
import {
  pulseAbsenceChange,
  pulseAbsenceDedupeKey,
  pulseCheckChange,
  pulseCheckDedupeKey,
  pulseCycleKey,
  sendPulseAbsence,
  sendPulseCheck,
  type PulseAbsenceChange,
  type PulseCheckChange,
  type PulseChild,
  type MachineScore,
  type PulseCycle,
  type PulseCycleView,
  type PulseWeek,
  type RecordedCheckChange,
  type UpcomingCycle,
} from './pulse-change';
import { openWeek, readWeekUnlockCode, WeekKeyError } from './week-batch';

export {
  pulseAbsenceChange,
  pulseCheckChange,
  type MachineScore,
  type PulseAbsenceChange,
  type PulseCheckChange,
  type PulseChild,
  type PulseCycle,
  type PulseCycleView,
  type PulseWeek,
  type RecordedCheckChange,
  type UpcomingCycle,
} from './pulse-change';

/** First day of the month of an ISO date, for example 2026-10-01 for 2026-10-18. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Last day of the month of an ISO date. */
export function monthEndOf(date: string): string {
  const [year = 0, month = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Last day of a week of the month (weeks are days 1-7, 8-14, 15-21 and 22-28). */
export function weekEndOf(month: string, week: number): string {
  return addDays(month, week * 7 - 1);
}

const CYCLE_COLUMNS = 'id, month, grade, language, first_week, sample_size, eligible_count';
// One literal, so that the client can type the rows it returns.
const CHILD_COLUMNS =
  'id, student_id, adapted, week, opens_on, due_on, replaces_sample_id, replaced_at, replacement_reason, students!inner(full_name, student_code), pulse_checks(id, attempt, mode, classroom, item_code, prompt_code, recorded_at, pulse_scores(reading_level, english_level, reached_level, wcpm, confidence, flags)), pulse_absences(absent_on)';

const READING_LEVELS = ['fluent', 'hesitant', 'needs_support'] as const;
const ENGLISH_LEVELS = ['sentences', 'words', 'no_response'] as const;
const REACHED_LEVELS = ['passage', 'words', 'letters'] as const;
/** Flags of a score that call for a person to listen. */
const UNSURE_FLAGS = ['low_confidence', 'no_speech', 'quiet'];

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((entry) => entry === value) ?? null;
}

/** The engine's score as the app shows it; null when absent or not of a known shape. */
function machineScoreOf(
  row: {
    reading_level: string;
    english_level: string;
    reached_level: string;
    wcpm: number | null;
    confidence: number;
    flags: string[];
  } | null,
): MachineScore | null {
  if (!row) {
    return null;
  }
  const readingLevel = oneOf(READING_LEVELS, row.reading_level);
  const englishLevel = oneOf(ENGLISH_LEVELS, row.english_level);
  const reachedLevel = oneOf(REACHED_LEVELS, row.reached_level);
  if (!readingLevel || !englishLevel || !reachedLevel) {
    return null;
  }
  return {
    readingLevel,
    englishLevel,
    reachedLevel,
    wcpm: row.wcpm,
    uncertain: row.flags.some((flag) => UNSURE_FLAGS.includes(flag)),
  };
}

/** The encrypted weeks of a cycle that this account may hold, with the keys already released. */
async function weeksOf(cycleId: string): Promise<PulseWeek[]> {
  const supabase = getSupabase();
  const [batches, keys] = await Promise.all([
    supabase
      .from('pulse_week_batches')
      .select('week, opens_on, iv, ciphertext, mac')
      .eq('cycle_id', cycleId)
      .order('week'),
    supabase.from('pulse_week_keys').select('week, key').eq('cycle_id', cycleId),
  ]);
  if (batches.error) {
    throw batches.error;
  }
  if (keys.error) {
    throw keys.error;
  }
  return batches.data.map((batch) => ({
    week: batch.week,
    opensOn: batch.opens_on,
    batch: { iv: batch.iv, ciphertext: batch.ciphertext, mac: batch.mac },
    key: keys.data.find((entry) => entry.week === batch.week)?.key ?? null,
  }));
}

function cycleOf(row: {
  id: string;
  month: string;
  grade: number;
  language: string;
  first_week: number;
  sample_size: number;
  eligible_count: number;
}): PulseCycle {
  return {
    id: row.id,
    month: row.month,
    grade: row.grade === 1 || row.grade === 2 ? row.grade : 3,
    language: row.language === 'en' ? 'en' : 'hi',
    firstWeek: row.first_week,
    sampleSize: row.sample_size,
    eligibleCount: row.eligible_count,
  };
}

/**
 * This month's Pulse of a class: the children the teacher can see now, and the coming weeks
 * encrypted, including next month's first weeks once that cycle has been drawn (from the 25th).
 * Kept on the device, so checks can be recorded in a classroom without a network.
 */
export function pulseCycleQuery(classSectionId: string) {
  return queryOptions({
    queryKey: pulseCycleKey(classSectionId),
    meta: { persist: true },
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PulseCycleView> => {
      const supabase = getSupabase();
      const today = todayInIndia();
      const month = monthOf(today);
      const nextMonth = addDays(monthEndOf(today), 1);
      const { data: cycles, error } = await supabase
        .from('pulse_cycles')
        .select(CYCLE_COLUMNS)
        .eq('class_section_id', classSectionId)
        .in('month', [month, nextMonth]);
      if (error) {
        throw error;
      }
      const cycle = cycles.find((row) => row.month === month);
      const next = cycles.find((row) => row.month === nextMonth);
      const upcoming: UpcomingCycle | null = next
        ? { cycle: cycleOf(next), weeks: await weeksOf(next.id) }
        : null;
      if (!cycle) {
        return { cycle: null, children: [], seenItems: {}, weeks: [], upcoming };
      }

      const [samples, weeks] = await Promise.all([
        supabase
          .from('pulse_samples')
          .select(CHILD_COLUMNS)
          .eq('cycle_id', cycle.id)
          .not('week', 'is', null)
          .order('opens_on')
          .order('draw_position'),
        weeksOf(cycle.id),
      ]);
      if (samples.error) {
        throw samples.error;
      }

      const children: PulseChild[] = samples.data.map((row) => ({
        sampleId: row.id,
        studentId: row.student_id,
        name: row.students.full_name,
        studentCode: row.students.student_code,
        adapted: row.adapted,
        week: row.week ?? 0,
        opensOn: row.opens_on ?? '',
        dueOn: row.due_on ?? '',
        replacesSampleId: row.replaces_sample_id,
        replacedAt: row.replaced_at,
        replacementReason:
          row.replacement_reason === 'absent' ||
          row.replacement_reason === 'left' ||
          row.replacement_reason === 'consent'
            ? row.replacement_reason
            : null,
        checks: row.pulse_checks
          .map((check) => ({
            id: check.id,
            attempt: check.attempt,
            mode: check.mode === 'adapted' ? ('adapted' as const) : ('recorded' as const),
            classroom:
              check.classroom === 'noisy'
                ? ('noisy' as const)
                : check.classroom === 'normal'
                  ? ('normal' as const)
                  : null,
            itemCode: check.item_code,
            promptCode: check.prompt_code,
            recordedAt: check.recorded_at,
            score: machineScoreOf(check.pulse_scores),
          }))
          .sort((a, b) => a.attempt - b.attempt),
        absences: row.pulse_absences.map((absence) => absence.absent_on).sort(),
      }));

      // Passages and prompts the children were given before, in any school (a child who moved
      // school brings their history), so that nobody gets one twice.
      const seenItems: Record<string, string[]> = {};
      const studentIds = [...new Set(children.map((child) => child.studentId))];
      if (studentIds.length > 0) {
        const { data: history, error: historyError } = await supabase.rpc('pulse_items_seen', {
          student_ids: studentIds,
        });
        if (historyError) {
          throw historyError;
        }
        for (const entry of history) {
          const seen = (seenItems[entry.student_id] ??= []);
          for (const code of [entry.item_code, entry.prompt_code]) {
            if (code) {
              seen.push(code);
            }
          }
        }
      }

      return { cycle: cycleOf(cycle), children, seenItems, weeks, upcoming };
    },
  });
}

/**
 * The cycle as of `today`. On a phone that has not been online since the month changed, next
 * month's cycle drawn ahead takes over, with its weeks locked until they are unlocked by key.
 */
export function viewOn(view: PulseCycleView, today: string): PulseCycleView {
  const upcoming = view.upcoming;
  if (!upcoming || today < upcoming.cycle.month) {
    return view;
  }
  return {
    cycle: upcoming.cycle,
    children: [],
    seenItems: view.seenItems,
    weeks: upcoming.weeks,
    upcoming: null,
  };
}

// -------------------------------------------------------------------------------------------------
// The CRP's unlock codes
// -------------------------------------------------------------------------------------------------

export interface WeekCode {
  cycleId: string;
  week: number;
  opensOn: string;
  key: string;
  classLabel: { grade: number; section: string };
  school: { id: string; name_en: string; name_hi: string | null };
}

/**
 * The keys of this month's weeks for the CRP's cluster: those already open, and the next two weeks,
 * which the database releases to the CRP early so that a visit without a network can still unlock
 * a week that opened while the teacher was offline. Kept on the device, encrypted.
 */
export function pulseWeekCodesQuery() {
  return queryOptions({
    queryKey: ['pulse-week-codes'],
    meta: { persist: true },
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<WeekCode[]> => {
      const { data, error } = await getSupabase()
        .from('pulse_week_keys')
        .select(
          'cycle_id, week, opens_on, key, class_sections!inner(grade, section, schools!inner(id, name_en, name_hi))',
        )
        .gte('opens_on', monthOf(todayInIndia()))
        .order('opens_on')
        .order('week');
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        cycleId: row.cycle_id,
        week: row.week,
        opensOn: row.opens_on,
        key: row.key,
        classLabel: { grade: row.class_sections.grade, section: row.class_sections.section },
        school: row.class_sections.schools,
      }));
    },
  });
}

// -------------------------------------------------------------------------------------------------
// Unlocking a week without a network
// -------------------------------------------------------------------------------------------------

/**
 * Weeks that have opened but whose children this device cannot show: the week began while it was
 * offline, so neither the children nor the key could be fetched. The CRP's QR code unlocks them.
 */
export function lockedWeeks(view: PulseCycleView, today: string): PulseWeek[] {
  return view.weeks.filter(
    (week) => week.opensOn <= today && !view.children.some((child) => child.week === week.week),
  );
}

export type UnlockOutcome =
  | { kind: 'unlocked'; week: number; children: number }
  | { kind: 'not-a-code' | 'other-class' | 'not-open' | 'not-on-device' | 'wrong-key' };

/**
 * Opens a week with the key from the CRP's QR code: decrypts the children kept on the device and
 * shows them, named from the class list kept on the device. Checks recorded for them are accepted
 * by the server, since their week has opened.
 */
export async function unlockWeek(
  queryClient: QueryClient,
  classSectionId: string,
  scanned: string,
  today = todayInIndia(),
): Promise<UnlockOutcome> {
  const code = readWeekUnlockCode(scanned);
  if (!code) {
    return { kind: 'not-a-code' };
  }
  const stored = queryClient.getQueryData<PulseCycleView>(pulseCycleKey(classSectionId));
  const view = stored ? viewOn(stored, today) : undefined;
  const cycle = view?.cycle;
  if (!view || cycle?.id !== code.cycleId) {
    return { kind: 'other-class' };
  }
  const week = view.weeks.find((entry) => entry.week === code.week);
  if (!week?.batch) {
    return { kind: 'not-on-device' };
  }
  if (week.opensOn > today) {
    return { kind: 'not-open' };
  }

  let opened;
  try {
    opened = await openWeek(code.keyHex, week.batch);
  } catch (error) {
    if (error instanceof WeekKeyError) {
      return { kind: 'wrong-key' };
    }
    throw error;
  }
  if (opened.cycleId !== cycle.id || opened.week !== week.week) {
    return { kind: 'wrong-key' };
  }

  const roster = queryClient.getQueryData(classRosterQuery(classSectionId).queryKey) ?? [];
  const added: PulseChild[] = opened.children
    .filter((child) => !view.children.some((known) => known.sampleId === child.sampleId))
    .map((child) => {
      const entry = roster.find((candidate) => candidate.studentId === child.studentId);
      return {
        sampleId: child.sampleId,
        studentId: child.studentId,
        name: entry?.fullName ?? '',
        studentCode: entry?.studentCode ?? '',
        adapted: child.adapted,
        week: opened.week,
        opensOn: week.opensOn,
        dueOn: weekEndOf(cycle.month, opened.week),
        replacesSampleId: null,
        replacedAt: null,
        replacementReason: null,
        checks: [],
        absences: [],
      };
    });

  queryClient.setQueryData(pulseCycleKey(classSectionId), (current: PulseCycleView | undefined) => {
    if (!current) {
      return current;
    }
    const base = viewOn(current, today);
    return {
      ...base,
      children: [...base.children, ...added],
      weeks: base.weeks.map((entry) =>
        entry.week === week.week ? { ...entry, key: code.keyHex } : entry,
      ),
    };
  });
  return { kind: 'unlocked', week: opened.week, children: added.length };
}

// -------------------------------------------------------------------------------------------------
// Saving
// -------------------------------------------------------------------------------------------------

/** The recording cannot be kept on this device and there is no network to send it directly. */
export class RecordingNotKeptError extends Error {
  constructor() {
    super('The recording cannot be kept on this device.');
    this.name = 'RecordingNotKeptError';
  }
}

async function keepOrSend(
  change: PulseCheckChange,
  queryClient: QueryClient,
  readFile: (id: string) => Promise<Blob>,
): Promise<{ queued: boolean }> {
  if (!navigator.onLine) {
    throw new RecordingNotKeptError();
  }
  try {
    const result = await sendPulseCheck(change, getSupabase(), readFile);
    pulseCheckChange.onSent?.(change, result, queryClient);
    return { queued: false };
  } finally {
    void queryClient.invalidateQueries({ queryKey: pulseCycleKey(change.classSectionId) });
  }
}

/**
 * Keeps a recorded check on the device, encrypted, and sends it in the background. When the device
 * cannot keep it (storage blocked or full), it is sent directly instead, which needs a connection.
 * Returns whether it waits on the device.
 */
export async function savePulseCheck(
  change: Omit<RecordedCheckChange, 'fileId'>,
  audio: Blob,
  queryClient: QueryClient,
): Promise<{ queued: boolean }> {
  if (offlineRuntime.isAvailable) {
    let fileId: string | null = null;
    try {
      fileId = await offlineRuntime.storeFile(audio);
      await offlineRuntime.enqueue(
        pulseCheckChange.kind,
        { ...change, fileId },
        pulseCheckDedupeKey(change.checkId),
      );
      return { queued: true };
    } catch (error) {
      if (fileId) {
        await offlineRuntime.deleteFiles([fileId]).catch(() => undefined);
      }
      if (!navigator.onLine) {
        throw error;
      }
    }
  }
  return keepOrSend({ ...change, fileId: crypto.randomUUID() }, queryClient, () =>
    Promise.resolve(audio),
  );
}

/** Keeps the adapted check of a child with special needs; nothing is recorded. */
export async function saveAdaptedCheck(
  change: Extract<PulseCheckChange, { mode: 'adapted' }>,
  queryClient: QueryClient,
): Promise<{ queued: boolean }> {
  if (offlineRuntime.isAvailable) {
    try {
      await offlineRuntime.enqueue(
        pulseCheckChange.kind,
        change,
        pulseCheckDedupeKey(change.checkId),
      );
      return { queued: true };
    } catch (error) {
      if (!navigator.onLine) {
        throw error;
      }
    }
  }
  return keepOrSend(change, queryClient, () =>
    Promise.reject(new Error('An adapted check carries no recording.')),
  );
}

/** Marks a drawn child absent today; kept on the device and sent like any other change. */
export async function markPulseAbsent(
  change: PulseAbsenceChange,
  queryClient: QueryClient,
): Promise<{ queued: boolean }> {
  if (offlineRuntime.isAvailable) {
    try {
      await offlineRuntime.enqueue(
        pulseAbsenceChange.kind,
        change,
        pulseAbsenceDedupeKey(change.sampleId, change.date),
      );
      return { queued: true };
    } catch (error) {
      if (!navigator.onLine) {
        throw error;
      }
    }
  }
  try {
    await sendPulseAbsence(change, getSupabase());
    pulseAbsenceChange.onSent?.(change, undefined, queryClient);
    return { queued: false };
  } finally {
    void queryClient.invalidateQueries({ queryKey: pulseCycleKey(change.classSectionId) });
  }
}
