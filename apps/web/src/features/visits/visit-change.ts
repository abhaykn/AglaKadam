import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { registerChange } from '@/features/offline/change-registry';
import { isAlreadyStored, storageFailure } from '@/features/offline/storage-upload';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import { classLabel } from '@/features/workspaces/grade-label';
import type { Json } from '@/lib/database.types';
import type { AppSupabaseClient } from '@/lib/supabase';

/**
 * Visits, the CRP's tasks, reviews of Pulse recordings and teachers' requests for a visit, as changes
 * kept on the device and sent when a network is available. Like attendance, they depend on nothing
 * that exists only in a page, so the service worker can send them after the application has been
 * closed.
 */

export const CODE = /^[a-z][a-z0-9-]{2,47}$/;
const READING_LEVELS = ['fluent', 'hesitant', 'needs_support'] as const;
const ENGLISH_LEVELS = ['sentences', 'words', 'no_response'] as const;
const dateTime = z.iso.datetime({ offset: true });

/** The CRP's visits of their cluster, as the server holds them. */
export function clusterVisitsKey() {
  return ['crp-visits'] as const;
}

/** The visits that took place in a class, as its teachers see them. */
export function classVisitsKey(classSectionId: string) {
  return ['class-visits', classSectionId] as const;
}

/** The device's working copy of a visit, kept until the server holds the same. */
export function visitDraftKey(visitId: string) {
  return ['visit-draft', visitId] as const;
}

export function crpSignalKey() {
  return ['crp-signal'] as const;
}

export function crpTasksKey() {
  return ['crp-tasks'] as const;
}

/** The recorded checks of a class's last two Pulse months, with scores and the CRP's reviews. */
export function classPulseChecksKey(classSectionId: string) {
  return ['class-pulse-checks', classSectionId] as const;
}

export function visitRequestsKey(classSectionId: string) {
  return ['visit-requests', classSectionId] as const;
}

/** The CRP's voice note of a visit, with its transcript once the engine has written it. */
export function visitNoteKey(visitId: string) {
  return ['visit-note', visitId] as const;
}

export const VISIT_NOTES_BUCKET = 'visit-notes';
/** A voice note lasts at most two minutes. */
export const VOICE_NOTE_MS = 120_000;
const NOTE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
const NOTE_EXTENSIONS: Record<(typeof NOTE_TYPES)[number], string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

const noteSchema = z.object({
  noteId: z.guid(),
  /** The recording kept, encrypted, on the device until it is uploaded. */
  fileId: z.guid(),
  contentType: z.enum(NOTE_TYPES),
  durationMs: z
    .number()
    .int()
    .min(1000)
    .max(VOICE_NOTE_MS + 1000),
  language: z.enum(['hi', 'en']),
  recordedAt: z.iso.datetime({ offset: true }),
});

export type VoiceNote = z.infer<typeof noteSchema>;

export function notePathOf(visitId: string, note: Pick<VoiceNote, 'noteId' | 'contentType'>) {
  return `${visitId}/${note.noteId}.${NOTE_EXTENSIONS[note.contentType]}`;
}

const observationSchema = z.object({
  itemCode: z.string().regex(CODE),
  position: z.number().int().min(1).max(5),
  answer: z.enum(['yes', 'no', 'not_seen']).nullable(),
  note: z.string().max(300),
});

const momentSchema = z.object({
  id: z.guid(),
  tagCode: z.string().regex(CODE),
  atSeconds: z.number().int().min(0).max(43_200),
  note: z.string().max(200),
});

const recheckSchema = z.object({
  checkId: z.guid(),
  studentId: z.guid(),
  readingLevel: z.enum(READING_LEVELS),
  englishLevel: z.enum(ENGLISH_LEVELS),
  note: z.string().max(300),
});

const evidenceSchema = z.union([
  z.object({ moment: z.guid() }).strict(),
  z.object({ item: z.string().regex(CODE) }).strict(),
]);

const feedbackSchema = z.object({
  strength: z.string().max(500),
  evidence: z.array(evidenceSchema).max(8),
  practiceCode: z.string().regex(CODE).nullable(),
  changeNote: z.string().max(500),
  technique: z.string().max(1000),
  demoGiven: z.boolean(),
  planNote: z.string().max(1000),
  checkBackOn: z.iso.date().nullable(),
  language: z.enum(['hi', 'en']),
  agreedAt: dateTime.nullable(),
});

export const visitSchema = z.object({
  id: z.guid(),
  classSectionId: z.guid(),
  schoolId: z.guid(),
  crpId: z.guid().nullable(),
  teacherId: z.guid().nullable(),
  status: z.enum(['planned', 'done']),
  plannedOn: z.iso.date().nullable(),
  visitedOn: z.iso.date().nullable(),
  startedAt: dateTime.nullable(),
  finishedAt: dateTime.nullable(),
  lessonNote: z.string().max(160),
  followsVisitId: z.guid().nullable(),
  followUpResult: z.enum(['practised', 'partly', 'not_yet']).nullable(),
  requestId: z.guid().nullable(),
  observations: z.array(observationSchema).max(5),
  moments: z.array(momentSchema).max(60),
  rechecks: z.array(recheckSchema).max(2),
  feedback: feedbackSchema.nullable(),
});

export type Visit = z.infer<typeof visitSchema>;
export type VisitFeedback = z.infer<typeof feedbackSchema>;
export type VisitObservation = z.infer<typeof observationSchema>;
export type VisitMoment = z.infer<typeof momentSchema>;
export type VisitRecheck = z.infer<typeof recheckSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

const classLabelSchema = z.object({ grade: z.number().int(), section: z.string() });

const visitChangeSchema = z.object({
  visit: visitSchema,
  /** The server's revision the device started from; null for a visit it has never held. */
  baseRevision: z.number().int().min(1).nullable(),
  /** A new identifier for every save, stored with the revision it writes. */
  changeId: z.guid(),
  /** This device's earlier saves of the visit that this one replaces. */
  supersedes: z.array(z.guid()).max(50),
  /** A voice note recorded on the device and not yet uploaded; sent after the visit. */
  note: noteSchema.nullable().default(null),
  /** For the list of waiting changes; null when the class's details were not on the phone. */
  classLabel: classLabelSchema.nullable(),
});

export type VisitChange = z.infer<typeof visitChangeSchema>;
export type ClassLabel = z.infer<typeof classLabelSchema>;

/** Error code of a save refused because another device changed the visit meanwhile. */
export const STALE_VISIT = 'stale_visit';
/** Error code of a save refused because the visit is closed (older than 14 days, or not one's own). */
export const CLOSED_VISIT = 'closed_visit';

/** The shortest and longest wait between a visit and its check-back, in days. */
export const CHECK_BACK_RANGE = { min: 3, max: 42 } as const;

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Whether the feedback is complete enough for the server: a strength, a practice and a date. */
export function feedbackIsComplete(visit: Visit): boolean {
  const feedback = visit.feedback;
  if (visit.status !== 'done' || !visit.visitedOn || !feedback) {
    return false;
  }
  if (!feedback.strength.trim() || !feedback.practiceCode || !feedback.checkBackOn) {
    return false;
  }
  const days = daysFrom(visit.visitedOn, feedback.checkBackOn);
  return days >= CHECK_BACK_RANGE.min && days <= CHECK_BACK_RANGE.max;
}

const blankToNull = (text: string) => (text.trim() ? text.trim() : null);

/**
 * The visit as `save_visit` takes it. Feedback still being drafted stays on the device and is left
 * out of the save, so that the server keeps the feedback it holds; a visit without feedback, or
 * one only planned, says so. Evidence names only moments still in the visit and focus items answered "yes".
 */
export function visitPayload(change: VisitChange): Json {
  const { visit } = change;
  const momentIds = new Set(visit.moments.map((moment) => moment.id));
  const seenItems = new Set(
    visit.observations.filter((item) => item.answer === 'yes').map((item) => item.itemCode),
  );
  const feedback = feedbackIsComplete(visit) ? visit.feedback : null;
  return {
    id: visit.id,
    change_id: change.changeId,
    supersedes: change.supersedes,
    base_revision: change.baseRevision,
    class_section_id: visit.classSectionId,
    teacher_id: visit.teacherId,
    status: visit.status,
    planned_on: visit.status === 'planned' ? visit.plannedOn : null,
    visited_on: visit.status === 'done' ? visit.visitedOn : null,
    started_at: visit.status === 'done' ? visit.startedAt : null,
    finished_at: visit.status === 'done' ? visit.finishedAt : null,
    lesson_note: blankToNull(visit.lessonNote),
    follows_visit_id: visit.followsVisitId,
    follow_up_result: visit.status === 'done' ? visit.followUpResult : null,
    request_id: visit.requestId,
    observations: visit.observations.map((item) => ({
      item_code: item.itemCode,
      position: item.position,
      answer: item.answer,
      note: blankToNull(item.note),
    })),
    moments: visit.moments.map((moment) => ({
      id: moment.id,
      tag_code: moment.tagCode,
      at_seconds: moment.atSeconds,
      note: blankToNull(moment.note),
    })),
    rechecks:
      visit.status === 'done'
        ? visit.rechecks.map((recheck) => ({
            check_id: recheck.checkId,
            reading_level: recheck.readingLevel,
            english_level: recheck.englishLevel,
            note: blankToNull(recheck.note),
          }))
        : [],
    ...(feedback
      ? {
          feedback: {
            strength: feedback.strength.trim(),
            evidence: feedback.evidence.filter((entry) =>
              'moment' in entry ? momentIds.has(entry.moment) : seenItems.has(entry.item),
            ),
            practice_code: feedback.practiceCode,
            change_note: blankToNull(feedback.changeNote),
            technique: blankToNull(feedback.technique),
            demo_given: feedback.demoGiven,
            plan_note: blankToNull(feedback.planNote),
            check_back_on: feedback.checkBackOn,
            language: feedback.language,
            agreed_at: feedback.agreedAt,
          },
        }
      : visit.feedback === null || visit.status === 'planned'
        ? { feedback: null }
        : {}),
  };
}

/**
 * Uploads a visit's voice note and records it, after the visit itself. Both steps can be repeated
 * safely: a note the server already holds is left as it is.
 */
async function sendNote(
  visitId: string,
  note: VoiceNote,
  supabase: AppSupabaseClient,
  readFile: (id: string) => Promise<Blob>,
): Promise<void> {
  const path = notePathOf(visitId, note);
  const { data: held, error: readError } = await supabase
    .from('visit_notes')
    .select('audio_path')
    .eq('visit_id', visitId)
    .maybeSingle();
  if (readError) {
    throw readError;
  }
  if (held?.audio_path === path) {
    return;
  }
  let audio: Blob;
  try {
    audio = await readFile(note.fileId);
  } catch {
    throw new ChangeRejectedError('file_missing', 'The voice note is no longer on this phone.');
  }
  const { error: uploadError } = await supabase.storage
    .from(VISIT_NOTES_BUCKET)
    .upload(path, audio, { contentType: note.contentType, upsert: false, cacheControl: '3600' });
  if (uploadError && !isAlreadyStored(uploadError)) {
    throw storageFailure(uploadError);
  }
  // The database takes the file's type and size from storage; these values only satisfy the
  // request's shape.
  const { error } = await supabase.from('visit_notes').upsert(
    {
      visit_id: visitId,
      note_id: note.noteId,
      audio_path: path,
      audio_type: note.contentType,
      audio_bytes: audio.size,
      duration_ms: Math.min(note.durationMs, 121_000),
      language: note.language,
      recorded_at: note.recordedAt,
    },
    { onConflict: 'visit_id' },
  );
  if (error) {
    throw error;
  }
}

/** What the server holds after a save: its revision, and whether the voice note was lost. */
export interface VisitSent {
  revision: number;
  /** The note's recording was no longer on the phone; the visit was saved without it. */
  noteMissing: boolean;
}

/** Reads the result of a sent save, including those of earlier versions (a bare revision). */
export function visitSentOf(result: unknown): VisitSent {
  if (typeof result === 'object' && result !== null && 'revision' in result) {
    return {
      revision: Number(result.revision),
      noteMissing: 'noteMissing' in result && result.noteMissing === true,
    };
  }
  return { revision: Number(result), noteMissing: false };
}

/** Sends a whole visit, then its voice note if one waits. */
export async function sendVisit(
  change: VisitChange,
  supabase: AppSupabaseClient,
  readFile: (id: string) => Promise<Blob> = () => Promise.reject(new Error('No files here.')),
): Promise<VisitSent> {
  const revision = await saveVisitRecord(change, supabase);
  if (change.note && change.visit.status === 'done') {
    try {
      await sendNote(change.visit.id, change.note, supabase, readFile);
    } catch (error) {
      // The recording was removed from the phone (for example with the change, in the list of
      // waiting changes): every later save would fail the same way, so the visit goes without it.
      if (error instanceof ChangeRejectedError && error.code === 'file_missing') {
        return { revision, noteMissing: true };
      }
      throw error;
    }
  }
  return { revision, noteMissing: false };
}

async function saveVisitRecord(change: VisitChange, supabase: AppSupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('save_visit', { visit: visitPayload(change) });
  if (error) {
    if (error.code === '40001') {
      // Not a passing conflict: sending the same save again would be refused the same way.
      throw new ChangeRejectedError(STALE_VISIT, error.message);
    }
    if (error.code === '42501' && /can no longer be changed/i.test(error.message)) {
      throw new ChangeRejectedError(CLOSED_VISIT, error.message);
    }
    throw error;
  }
  return data;
}

/** The device's working copy of a visit and what it knows of the server's. */
export interface VisitDraft {
  visit: Visit;
  baseRevision: number | null;
  /** Saves of this draft not yet known to be written, oldest first. */
  pendingChanges: string[];
  /** A voice note recorded on the device that the server does not hold yet. */
  pendingNote?: VoiceNote | null;
  /** The last note's recording was gone from the phone before it could be uploaded. */
  noteMissing?: boolean;
}

const PENDING_LIMIT = 50;

export function rememberDraftQueries(queryClient: QueryClient): void {
  queryClient.setQueryDefaults(['visit-draft'], {
    meta: { persist: true },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

export function draftOf(queryClient: QueryClient, visitId: string): VisitDraft | undefined {
  return queryClient.getQueryData<VisitDraft | null>(visitDraftKey(visitId)) ?? undefined;
}

/** Every working copy of a visit on the device. */
export function draftsOf(queryClient: QueryClient): VisitDraft[] {
  return queryClient
    .getQueriesData<VisitDraft | null>({ queryKey: ['visit-draft'] })
    .flatMap(([, draft]) => (draft ? [draft] : []));
}

/**
 * Replaces the working copy so that pages showing it update at once. A removed query would leave
 * them showing the old copy, so an empty copy is kept instead.
 */
function setDraft(
  queryClient: QueryClient,
  visitId: string,
  next: (draft: VisitDraft | undefined) => VisitDraft | null,
): void {
  queryClient.setQueryData<VisitDraft | null>(visitDraftKey(visitId), (draft) =>
    next(draft ?? undefined),
  );
}

/**
 * Whether the server holds everything the working copy does: nothing waits to be sent, and its
 * feedback is either complete (and so sent) or absent.
 */
function isSettled(draft: VisitDraft): boolean {
  return (
    draft.baseRevision !== null &&
    draft.pendingChanges.length === 0 &&
    !draft.pendingNote &&
    !draft.noteMissing &&
    (draft.visit.feedback === null || feedbackIsComplete(draft.visit))
  );
}

/**
 * Keeps a new version of the visit as the device's working copy and returns the change that sends
 * it. A visit the device never saved starts from the server's revision, if the server holds it.
 */
export function nextVisitChange(
  queryClient: QueryClient,
  visit: Visit,
  serverRevision: number | null,
  label: ClassLabel | null,
): VisitChange {
  rememberDraftQueries(queryClient);
  const draft = draftOf(queryClient, visit.id);
  const baseRevision = draft ? draft.baseRevision : serverRevision;
  const pending = draft?.pendingChanges ?? [];
  const changeId = crypto.randomUUID();
  const pendingNote = draft?.pendingNote ?? null;
  setDraft(queryClient, visit.id, () => ({
    visit,
    baseRevision,
    pendingChanges: [...pending, changeId].slice(-PENDING_LIMIT),
    pendingNote,
    noteMissing: draft?.noteMissing ?? false,
  }));
  return {
    visit,
    baseRevision,
    changeId,
    supersedes: pending.slice(-PENDING_LIMIT),
    note: pendingNote,
    classLabel: label,
  };
}

/**
 * Keeps a new voice note with the visit's working copy, so that the next save carries it. A note
 * recorded again replaces the earlier one, which is then never uploaded.
 */
export function attachNote(
  queryClient: QueryClient,
  visit: Visit,
  serverRevision: number | null,
  note: VoiceNote,
): void {
  rememberDraftQueries(queryClient);
  setDraft(queryClient, visit.id, (draft) => ({
    visit: draft?.visit ?? visit,
    baseRevision: draft ? draft.baseRevision : serverRevision,
    pendingChanges: draft?.pendingChanges ?? [],
    pendingNote: note,
    noteMissing: false,
  }));
}

/**
 * After the server wrote a save: the draft builds on that revision from now on, and is dropped once
 * the server holds all of it.
 */
export function draftSaved(queryClient: QueryClient, change: VisitChange, sent: VisitSent): void {
  setDraft(queryClient, change.visit.id, (draft) => {
    if (!draft) {
      return null;
    }
    const index = draft.pendingChanges.indexOf(change.changeId);
    const noteDone =
      change.note !== null &&
      change.visit.status === 'done' &&
      draft.pendingNote?.noteId === change.note.noteId;
    const next: VisitDraft = {
      ...draft,
      baseRevision: sent.revision,
      // Saves made before this one are written or replaced by it; later ones are still to come.
      pendingChanges: index === -1 ? draft.pendingChanges : draft.pendingChanges.slice(index + 1),
      pendingNote: noteDone ? null : (draft.pendingNote ?? null),
      noteMissing: noteDone ? sent.noteMissing : (draft.noteMissing ?? false),
    };
    return isSettled(next) && serverHolds(queryClient, change.visit.id, sent.revision)
      ? null
      : next;
  });
}

/** Whether the device's list of the cluster's visits holds this revision of the visit. */
function serverHolds(queryClient: QueryClient, visitId: string, revision: number): boolean {
  return (
    queryClient
      .getQueryData<StoredVisit[]>(clusterVisitsKey())
      ?.some((visit) => visit.id === visitId && visit.revision >= revision) ?? false
  );
}

/**
 * Brings the working copies in line with the server's visits. A save sent while no page was open
 * (by the service worker) is recognised by its identifier; a copy with nothing left to send that
 * another device has since changed gives way to the server's version.
 */
export function reconcileDrafts(queryClient: QueryClient, stored: readonly StoredVisit[]): void {
  for (const draft of draftsOf(queryClient)) {
    const held = stored.find((visit) => visit.id === draft.visit.id);
    if (!held) {
      continue;
    }
    const index =
      held.clientChangeId === null ? -1 : draft.pendingChanges.indexOf(held.clientChangeId);
    if (index !== -1) {
      setDraft(queryClient, draft.visit.id, (current) => {
        if (!current) {
          return null;
        }
        const next: VisitDraft = {
          ...current,
          baseRevision: held.revision,
          pendingChanges: current.pendingChanges.slice(
            current.pendingChanges.indexOf(held.clientChangeId ?? '') + 1,
          ),
        };
        return isSettled(next) ? null : next;
      });
    } else if (
      draft.pendingChanges.length === 0 &&
      !draft.pendingNote &&
      held.revision > (draft.baseRevision ?? 0)
    ) {
      setDraft(queryClient, draft.visit.id, () => null);
    }
  }
  // Empty copies that no page shows any more are forgotten.
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['visit-draft'] })) {
    if (query.state.data === null && query.getObserversCount() === 0) {
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

/** The server holds the voice note the working copy was waiting to upload. */
export function noteUploaded(queryClient: QueryClient, visitId: string, path: string): void {
  setDraft(queryClient, visitId, (draft) => {
    if (!draft?.pendingNote || notePathOf(visitId, draft.pendingNote) !== path) {
      return draft ?? null;
    }
    const next: VisitDraft = { ...draft, pendingNote: null, noteMissing: false };
    return isSettled(next) && serverHolds(queryClient, visitId, next.baseRevision ?? 0)
      ? null
      : next;
  });
}

/** Drops the device's working copy, for example to take the server's version instead. */
export function discardDraft(queryClient: QueryClient, visitId: string): void {
  setDraft(queryClient, visitId, () => null);
}

export interface StoredVisit extends Visit {
  revision: number;
  /** The save that wrote this revision, when a device sent it through `save_visit`. */
  clientChangeId: string | null;
}

/** Shows a sent visit in the cached list of the cluster's visits at once. */
function showSavedVisit(queryClient: QueryClient, change: VisitChange, revision: number): void {
  const { visit } = change;
  queryClient.setQueryData<StoredVisit[]>(clusterVisitsKey(), (visits) => {
    if (!visits) {
      return visits;
    }
    const held = visits.find((entry) => entry.id === visit.id);
    const stored: StoredVisit = {
      ...visit,
      // Feedback still being drafted was not sent: the server kept what it had.
      feedback: feedbackIsComplete(visit)
        ? visit.feedback
        : visit.feedback === null
          ? null
          : (held?.feedback ?? null),
      revision,
      clientChangeId: change.changeId,
    };
    return [...visits.filter((entry) => entry.id !== visit.id), stored];
  });
}

export const visitSaveChange = registerChange<VisitChange>({
  kind: 'visit.save',
  schema: visitChangeSchema,
  // Two minutes of voice on a slow connection needs longer than the usual limit.
  timeoutMs: 120_000,
  send: (change, context) => sendVisit(change, context.supabase, context.readFile),
  files: (change) => (change.note ? [change.note.fileId] : []),
  onSent: (change, result, queryClient) => {
    const sent = visitSentOf(result);
    showSavedVisit(queryClient, change, sent.revision);
    draftSaved(queryClient, change, sent);
  },
  invalidates: (change) => [
    clusterVisitsKey(),
    crpSignalKey(),
    classVisitsKey(change.visit.classSectionId),
    visitNoteKey(change.visit.id),
  ],
  describe: (change, t, language) =>
    t(change.visit.status === 'planned' ? 'visits.change.plan' : 'visits.change.visit', {
      class: change.classLabel
        ? classLabel(t, change.classLabel.grade, change.classLabel.section)
        : t('visits.pack.title'),
      date: formatDate(
        change.visit.status === 'planned' ? change.visit.plannedOn : change.visit.visitedOn,
        language,
      ),
    }),
});

export function visitDedupeKey(visitId: string): string {
  return `visit:${visitId}`;
}

function formatDate(date: string | null, language: string): string {
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

const visitRemoveSchema = z.object({
  visitId: z.guid(),
  classSectionId: z.guid(),
  plannedOn: z.iso.date(),
  classLabel: classLabelSchema.nullable(),
});

export type VisitRemoveChange = z.infer<typeof visitRemoveSchema>;

/** Drops a planned visit; a visit that took place is never removed. */
export const visitRemoveChange = registerChange<VisitRemoveChange>({
  kind: 'visit.remove',
  schema: visitRemoveSchema,
  send: async (change, context) => {
    const { error } = await context.supabase
      .from('visits')
      .delete()
      .eq('id', change.visitId)
      .eq('status', 'planned');
    if (error) {
      throw error;
    }
    return null;
  },
  onSent: (change, _result, queryClient) => {
    discardDraft(queryClient, change.visitId);
    queryClient.setQueryData<StoredVisit[]>(clusterVisitsKey(), (visits) =>
      visits?.filter((entry) => entry.id !== change.visitId),
    );
  },
  invalidates: () => [clusterVisitsKey(), crpSignalKey()],
  describe: (change, t, language) =>
    t('visits.change.unplan', {
      class: change.classLabel
        ? classLabel(t, change.classLabel.grade, change.classLabel.section)
        : t('visits.pack.title'),
      date: formatDate(change.plannedOn, language),
    }),
});

const taskSchema = z.object({
  id: z.guid(),
  clusterId: z.guid(),
  schoolId: z.guid().nullable(),
  title: z.string().min(1).max(200),
  details: z.string().max(2000),
  source: z.enum(['order', 'circular', 'meeting', 'own']),
  dueOn: z.iso.date().nullable(),
  done: z.boolean(),
  /** When it was marked done on the device. */
  doneAt: dateTime.nullable(),
  removed: z.boolean(),
});

export type CrpTask = z.infer<typeof taskSchema>;

export function taskDedupeKey(taskId: string): string {
  return `crp-task:${taskId}`;
}

/** Adds, changes or removes a task of the cluster; the latest version on the device wins. */
export const taskChange = registerChange<CrpTask>({
  kind: 'crp.task',
  schema: taskSchema,
  send: async (task, context) => {
    if (task.removed) {
      const { error } = await context.supabase.from('crp_tasks').delete().eq('id', task.id);
      if (error) {
        throw error;
      }
      return null;
    }
    const { error } = await context.supabase.from('crp_tasks').upsert(
      {
        id: task.id,
        cluster_id: task.clusterId,
        school_id: task.schoolId,
        title: task.title.trim(),
        details: blankToNull(task.details),
        source: task.source,
        due_on: task.dueOn,
        done_at: task.done ? (task.doneAt ?? new Date().toISOString()) : null,
      },
      { onConflict: 'id' },
    );
    if (error) {
      throw error;
    }
    return null;
  },
  invalidates: () => [crpTasksKey(), crpSignalKey()],
  describe: (task, t) =>
    t(task.removed ? 'visits.change.taskRemoved' : 'visits.change.task', { title: task.title }),
});

const reviewSchema = z.object({
  checkId: z.guid(),
  classSectionId: z.guid(),
  readingLevel: z.enum(READING_LEVELS),
  englishLevel: z.enum(ENGLISH_LEVELS),
  note: z.string().max(300),
  childName: z.string().max(120),
});

export type PulseReviewChange = z.infer<typeof reviewSchema>;

export function reviewDedupeKey(checkId: string): string {
  return `pulse-review:${checkId}`;
}

/** The CRP's own levels for a Pulse recording they listened to. */
export const pulseReviewChange = registerChange<PulseReviewChange>({
  kind: 'pulse.review',
  schema: reviewSchema,
  send: async (review, context) => {
    const { error } = await context.supabase.from('pulse_reviews').upsert(
      {
        check_id: review.checkId,
        class_section_id: review.classSectionId,
        reading_level: review.readingLevel,
        english_level: review.englishLevel,
        note: blankToNull(review.note),
      },
      { onConflict: 'check_id' },
    );
    if (error) {
      throw error;
    }
    return null;
  },
  invalidates: (review) => [classPulseChecksKey(review.classSectionId), crpSignalKey()],
  describe: (review, t) => t('visits.change.review', { name: review.childName }),
});

const requestSchema = z.object({
  classSectionId: z.guid(),
  schoolId: z.guid(),
  /** The open request being withdrawn; null when asking for a visit. */
  withdrawId: z.guid().nullable(),
  topic: z.enum(['reading', 'english', 'classroom', 'other']),
  note: z.string().max(300),
  classLabel: classLabelSchema,
});

export type VisitRequestChange = z.infer<typeof requestSchema>;

export function requestDedupeKey(classSectionId: string): string {
  return `visit-request:${classSectionId}`;
}

/** A teacher asks for a visit to a class, or withdraws the request. */
export const visitRequestChange = registerChange<VisitRequestChange>({
  kind: 'visit.request',
  schema: requestSchema,
  send: async (request, context) => {
    if (request.withdrawId) {
      const { data, error } = await context.supabase
        .from('visit_requests')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('id', request.withdrawId)
        .select('id');
      if (error) {
        throw error;
      }
      // The update reaches no row the person may not change; that is a refusal, not a success.
      if (data.length === 0) {
        throw new ChangeRejectedError('42501', 'The request is not one this account may withdraw.');
      }
      return null;
    }
    const { error } = await context.supabase.from('visit_requests').insert({
      class_section_id: request.classSectionId,
      school_id: request.schoolId,
      topic: request.topic,
      note: blankToNull(request.note),
    });
    // A request already open for the class answers the same need.
    if (error && error.code !== '23505') {
      throw error;
    }
    return null;
  },
  invalidates: (request) => [visitRequestsKey(request.classSectionId)],
  describe: (request, t) =>
    t(request.withdrawId ? 'visits.change.requestWithdrawn' : 'visits.change.request', {
      class: classLabel(t, request.classLabel.grade, request.classLabel.section),
    }),
});
