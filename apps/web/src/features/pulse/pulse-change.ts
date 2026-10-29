import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { formatDay } from '@/features/attendance/dates';
import { registerChange } from '@/features/offline/change-registry';
import { isAlreadyStored, storageFailure } from '@/features/offline/storage-upload';
import { classLabel } from '@/features/workspaces/grade-label';
import type { AppSupabaseClient } from '@/lib/supabase';
import type { EncryptedWeek } from './week-batch';

/**
 * Pulse checks and absences as changes kept on the device and sent when a network is available.
 * Like attendance, they depend on nothing that exists only in a page, so the service worker can
 * send them after the application has been closed.
 */

export const PULSE_AUDIO_BUCKET = 'pulse-audio';

/** Query key of the current Pulse cycle of a class, with the children the teacher can see. */
export function pulseCycleKey(classSectionId: string) {
  return ['pulse-cycle', classSectionId] as const;
}

/** What the speech engine measured in a recording, on the teacher's scales. */
export interface MachineScore {
  readingLevel: 'fluent' | 'hesitant' | 'needs_support';
  englishLevel: 'sentences' | 'words' | 'no_response';
  reachedLevel: 'passage' | 'words' | 'letters';
  /** Words of the passage read correctly per minute; null below the passage. */
  wcpm: number | null;
  /** The engine was unsure (little speech, or low confidence): a person should listen. */
  uncertain: boolean;
}

export interface PulseCheckSummary {
  id: string;
  attempt: number;
  mode: 'recorded' | 'adapted';
  classroom: 'normal' | 'noisy' | null;
  itemCode: string | null;
  promptCode: string | null;
  recordedAt: string;
  /** Once the engine has scored the recording (overnight). */
  score?: MachineScore | null;
}

export interface PulseChild {
  sampleId: string;
  studentId: string;
  name: string;
  studentCode: string;
  /** Receives the adapted, teacher-observed check (a child with special needs). */
  adapted: boolean;
  week: number;
  opensOn: string;
  dueOn: string;
  replacesSampleId: string | null;
  replacedAt: string | null;
  replacementReason: 'absent' | 'left' | 'consent' | null;
  checks: PulseCheckSummary[];
  absences: string[];
}

export interface PulseCycle {
  id: string;
  month: string;
  grade: 1 | 2 | 3;
  /** Language of the reading passage (the class's medium); the speaking part is English. */
  language: 'hi' | 'en';
  firstWeek: number;
  sampleSize: number;
  eligibleCount: number;
}

/** A week of the cycle as the phone holds it: its children encrypted, and its key once released. */
export interface PulseWeek {
  week: number;
  opensOn: string;
  batch: EncryptedWeek | null;
  key: string | null;
}

/** Next month's cycle, drawn in the last days of a month: its weeks, all still locked. */
export interface UpcomingCycle {
  cycle: PulseCycle;
  weeks: PulseWeek[];
}

export interface PulseCycleView {
  cycle: PulseCycle | null;
  children: PulseChild[];
  /** Passage and prompt codes each visible child has already been given, in any school. */
  seenItems: Record<string, string[]>;
  weeks: PulseWeek[];
  /** Kept so that a phone offline when the month changes still holds the new month's first week. */
  upcoming?: UpcomingCycle | null;
}

const CONTENT_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
const EXTENSIONS: Record<(typeof CONTENT_TYPES)[number], string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

const classLabelSchema = z.object({ grade: z.number().int(), section: z.string() });

const ITEM_CODE = /^[a-z0-9][a-z0-9-]{2,47}$/;
const TAGS = [
  'missed_words',
  'good_pace',
  'repeated_line',
  'mixed_languages',
  'needed_prompting',
] as const;

const checkBase = {
  /** Chosen on the device; also names the audio file, so a resend is recognised. */
  checkId: z.guid(),
  sampleId: z.guid(),
  classSectionId: z.guid(),
  studentId: z.guid(),
  readingLevel: z.enum(['fluent', 'hesitant', 'needs_support']),
  englishLevel: z.enum(['sentences', 'words', 'no_response']),
  tags: z.array(z.enum(TAGS)).max(5),
  recordedAt: z.iso.datetime({ offset: true }),
  childName: z.string().max(120),
  classLabel: classLabelSchema,
};

const pulseCheckSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('recorded'),
    ...checkBase,
    attempt: z.union([z.literal(1), z.literal(2)]),
    itemCode: z.string().regex(ITEM_CODE),
    promptCode: z.string().regex(ITEM_CODE),
    /** What was shown, and when the screen changed; stored with the check for scoring. */
    item: z.record(z.string(), z.json()),
    /** The recording, kept encrypted on the device until it has been uploaded. */
    fileId: z.guid(),
    contentType: z.enum(CONTENT_TYPES),
    durationMs: z.number().int().min(1000).max(61_000),
    noiseDbfs: z.number().min(-160).max(0).nullable(),
    clarity: z.enum(['clear', 'low_voice', 'nervous']),
    classroom: z.enum(['normal', 'noisy']),
  }),
  /** The teacher-observed check of a child with special needs: nothing is recorded. */
  z.object({ mode: z.literal('adapted'), ...checkBase }),
]);

export type PulseCheckChange = z.infer<typeof pulseCheckSchema>;
export type RecordedCheckChange = Extract<PulseCheckChange, { mode: 'recorded' }>;

const pulseAbsenceSchema = z.object({
  sampleId: z.guid(),
  classSectionId: z.guid(),
  date: z.iso.date(),
  childName: z.string().max(120),
  classLabel: classLabelSchema,
});

export type PulseAbsenceChange = z.infer<typeof pulseAbsenceSchema>;

/**
 * Where a check's recording is stored: `<class section>/<drawn child>/<check>.<extension>`. Storage
 * accepts it only for a child who is due and whose family consents to audio checks.
 */
export function audioPathOf(
  change: Pick<RecordedCheckChange, 'classSectionId' | 'sampleId' | 'checkId' | 'contentType'>,
) {
  return `${change.classSectionId}/${change.sampleId}/${change.checkId}.${EXTENSIONS[change.contentType]}`;
}

/**
 * Records a check. A recorded check uploads its audio first; both steps can be repeated safely: a
 * recording already uploaded by an earlier attempt is kept, and a check already recorded is left as
 * it is.
 */
export async function sendPulseCheck(
  change: PulseCheckChange,
  supabase: AppSupabaseClient,
  readFile: (id: string) => Promise<Blob>,
): Promise<{ checkId: string }> {
  // The database takes the class and child from the draw, and a file's type and size from
  // storage; the values sent for them only satisfy the request's shape.
  const common = {
    id: change.checkId,
    sample_id: change.sampleId,
    class_section_id: change.classSectionId,
    student_id: change.studentId,
    mode: change.mode,
    reading_level: change.readingLevel,
    english_level: change.englishLevel,
    tags: change.tags,
    recorded_at: change.recordedAt,
  };

  if (change.mode === 'adapted') {
    const { error } = await supabase
      .from('pulse_checks')
      .upsert(common, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      throw error;
    }
    return { checkId: change.checkId };
  }

  const path = audioPathOf(change);
  const audio = await readFile(change.fileId);
  const { error: uploadError } = await supabase.storage
    .from(PULSE_AUDIO_BUCKET)
    .upload(path, audio, { contentType: change.contentType, upsert: false, cacheControl: '3600' });
  if (uploadError && !isAlreadyStored(uploadError)) {
    throw storageFailure(uploadError);
  }

  const { error } = await supabase.from('pulse_checks').upsert(
    {
      ...common,
      attempt: change.attempt,
      item_code: change.itemCode,
      prompt_code: change.promptCode,
      item: change.item,
      audio_path: path,
      audio_type: change.contentType,
      audio_bytes: audio.size,
      duration_ms: change.durationMs,
      noise_dbfs: change.noiseDbfs,
      clarity: change.clarity,
      classroom: change.classroom,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) {
    throw error;
  }
  return { checkId: change.checkId };
}

export async function sendPulseAbsence(
  change: PulseAbsenceChange,
  supabase: AppSupabaseClient,
): Promise<void> {
  const { error } = await supabase
    .from('pulse_absences')
    .upsert(
      { sample_id: change.sampleId, absent_on: change.date },
      { onConflict: 'sample_id,absent_on', ignoreDuplicates: true },
    );
  if (error) {
    throw error;
  }
}

/** Updates the cached cycle of a class, when it is loaded, so the screen shows what was sent. */
function updateChild(
  queryClient: QueryClient,
  classSectionId: string,
  sampleId: string,
  update: (child: PulseChild) => PulseChild,
): void {
  queryClient.setQueryData(pulseCycleKey(classSectionId), (view: PulseCycleView | undefined) =>
    view
      ? {
          ...view,
          children: view.children.map((child) =>
            child.sampleId === sampleId ? update(child) : child,
          ),
        }
      : view,
  );
}

export const pulseCheckChange = registerChange<PulseCheckChange>({
  kind: 'pulse.check',
  schema: pulseCheckSchema,
  // A minute of audio on a slow connection needs longer than the usual limit.
  timeoutMs: 120_000,
  send: (change, context) => sendPulseCheck(change, context.supabase, context.readFile),
  files: (change) => (change.mode === 'recorded' ? [change.fileId] : []),
  onSent: (change, _result, queryClient) => {
    updateChild(queryClient, change.classSectionId, change.sampleId, (child) =>
      child.checks.some((check) => check.id === change.checkId)
        ? child
        : {
            ...child,
            checks: [
              ...child.checks,
              change.mode === 'recorded'
                ? {
                    id: change.checkId,
                    attempt: change.attempt,
                    mode: 'recorded',
                    classroom: change.classroom,
                    itemCode: change.itemCode,
                    promptCode: change.promptCode,
                    recordedAt: change.recordedAt,
                  }
                : {
                    id: change.checkId,
                    attempt: 1,
                    mode: 'adapted',
                    classroom: null,
                    itemCode: null,
                    promptCode: null,
                    recordedAt: change.recordedAt,
                  },
            ],
          },
    );
  },
  invalidates: (change) => [pulseCycleKey(change.classSectionId)],
  describe: (change, t) =>
    t('pulse.changes.check', {
      name: change.childName,
      class: classLabel(t, change.classLabel.grade, change.classLabel.section),
    }),
});

export const pulseAbsenceChange = registerChange<PulseAbsenceChange>({
  kind: 'pulse.absence',
  schema: pulseAbsenceSchema,
  send: (change, context) => sendPulseAbsence(change, context.supabase),
  onSent: (change, _result, queryClient) => {
    updateChild(queryClient, change.classSectionId, change.sampleId, (child) =>
      child.absences.includes(change.date)
        ? child
        : { ...child, absences: [...child.absences, change.date] },
    );
  },
  invalidates: (change) => [pulseCycleKey(change.classSectionId)],
  describe: (change, t, language) =>
    t('pulse.changes.absence', { name: change.childName, date: formatDay(change.date, language) }),
});

export function pulseCheckDedupeKey(checkId: string): string {
  return `pulse-check:${checkId}`;
}

export function pulseAbsenceDedupeKey(sampleId: string, date: string): string {
  return `pulse-absence:${sampleId}:${date}`;
}
