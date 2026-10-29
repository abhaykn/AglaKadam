import { matchQuery, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { keepOrSend } from '@/features/offline/keep-or-send';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import type { Database } from '@/lib/database.types';
import { getSupabase } from '@/lib/supabase';
import type { ClassSignal } from './plan';
import { addDays } from './plan';
import {
  classPulseChecksKey,
  classVisitsKey,
  clusterVisitsKey,
  crpSignalKey,
  crpTasksKey,
  discardDraft,
  draftOf,
  draftsOf,
  nextVisitChange,
  reconcileDrafts,
  rememberDraftQueries,
  reviewDedupeKey,
  requestDedupeKey,
  sendVisit,
  taskDedupeKey,
  visitDraftKey,
  visitDedupeKey,
  visitRequestsKey,
  visitSaveChange,
  pulseReviewChange,
  taskChange,
  visitRequestChange,
  visitRemoveChange,
  type ClassLabel,
  type CrpTask,
  type Evidence,
  type PulseReviewChange,
  type StoredVisit,
  type Visit,
  type VisitDraft,
  type VisitRemoveChange,
  type VisitRequestChange,
  type VoiceNote,
  attachNote,
  visitNoteKey,
} from './visit-change';

/** Visits further back than this are not kept on the device. */
const HISTORY_DAYS = 180;

// One literal, so that the client can type the rows it returns.
const VISIT_COLUMNS =
  'id, class_section_id, school_id, crp_id, teacher_id, status, planned_on, visited_on, started_at, finished_at, lesson_note, follows_visit_id, follow_up_result, request_id, revision, client_change_id, visit_observations(item_code, position, answer, note), visit_moments(id, tag_code, at_seconds, note), visit_rechecks(check_id, reading_level, english_level, note, pulse_checks(student_id)), visit_feedback(strength, evidence, practice_code, change_note, technique, demo_given, plan_note, check_back_on, language, agreed_at)';

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return values.find((entry) => entry === value) ?? fallback;
}

const READING = ['fluent', 'hesitant', 'needs_support'] as const;
const ENGLISH = ['sentences', 'words', 'no_response'] as const;

interface VisitRow {
  id: string;
  class_section_id: string;
  school_id: string;
  crp_id: string | null;
  teacher_id: string | null;
  status: string;
  planned_on: string | null;
  visited_on: string | null;
  started_at: string | null;
  finished_at: string | null;
  lesson_note: string | null;
  follows_visit_id: string | null;
  follow_up_result: string | null;
  request_id: string | null;
  revision: number;
  client_change_id: string | null;
  visit_observations: {
    item_code: string;
    position: number;
    answer: string | null;
    note: string | null;
  }[];
  visit_moments: { id: string; tag_code: string; at_seconds: number; note: string | null }[];
  visit_rechecks: {
    check_id: string;
    reading_level: string;
    english_level: string;
    note: string | null;
    pulse_checks: { student_id: string } | null;
  }[];
  visit_feedback: {
    strength: string;
    evidence: unknown;
    practice_code: string;
    change_note: string | null;
    technique: string | null;
    demo_given: boolean;
    plan_note: string | null;
    check_back_on: string;
    language: string;
    agreed_at: string | null;
  } | null;
}

function evidenceOf(value: unknown): Evidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown): Evidence[] => {
    if (entry && typeof entry === 'object') {
      if ('moment' in entry && typeof entry.moment === 'string') {
        return [{ moment: entry.moment }];
      }
      if ('item' in entry && typeof entry.item === 'string') {
        return [{ item: entry.item }];
      }
    }
    return [];
  });
}

export function toStoredVisit(row: VisitRow): StoredVisit {
  const feedback = row.visit_feedback;
  return {
    id: row.id,
    classSectionId: row.class_section_id,
    schoolId: row.school_id,
    crpId: row.crp_id,
    teacherId: row.teacher_id,
    status: row.status === 'done' ? 'done' : 'planned',
    plannedOn: row.planned_on,
    visitedOn: row.visited_on,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lessonNote: row.lesson_note ?? '',
    followsVisitId: row.follows_visit_id,
    followUpResult:
      row.follow_up_result === 'practised' ||
      row.follow_up_result === 'partly' ||
      row.follow_up_result === 'not_yet'
        ? row.follow_up_result
        : null,
    requestId: row.request_id,
    revision: row.revision,
    clientChangeId: row.client_change_id,
    observations: [...row.visit_observations]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        itemCode: item.item_code,
        position: item.position,
        answer:
          item.answer === 'yes' || item.answer === 'no' || item.answer === 'not_seen'
            ? item.answer
            : null,
        note: item.note ?? '',
      })),
    moments: [...row.visit_moments]
      .sort((a, b) => a.at_seconds - b.at_seconds)
      .map((moment) => ({
        id: moment.id,
        tagCode: moment.tag_code,
        atSeconds: moment.at_seconds,
        note: moment.note ?? '',
      })),
    rechecks: row.visit_rechecks.map((recheck) => ({
      checkId: recheck.check_id,
      studentId: recheck.pulse_checks?.student_id ?? recheck.check_id,
      readingLevel: oneOf(READING, recheck.reading_level, 'hesitant'),
      englishLevel: oneOf(ENGLISH, recheck.english_level, 'words'),
      note: recheck.note ?? '',
    })),
    feedback: feedback
      ? {
          strength: feedback.strength,
          evidence: evidenceOf(feedback.evidence),
          practiceCode: feedback.practice_code,
          changeNote: feedback.change_note ?? '',
          technique: feedback.technique ?? '',
          demoGiven: feedback.demo_given,
          planNote: feedback.plan_note ?? '',
          checkBackOn: feedback.check_back_on,
          language: feedback.language === 'en' ? 'en' : 'hi',
          agreedAt: feedback.agreed_at,
        }
      : null,
  };
}

/** The CRP's visits of their cluster: planned ones, and those of the last six months. */
export function clusterVisitsQuery() {
  return queryOptions({
    queryKey: clusterVisitsKey(),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<StoredVisit[]> => {
      const since = addDays(todayInIndia(), -HISTORY_DAYS);
      const { data, error } = await getSupabase()
        .from('visits')
        .select(VISIT_COLUMNS)
        .or(`status.eq.planned,visited_on.gte.${since}`)
        .order('visited_on', { ascending: false, nullsFirst: true });
      if (error) {
        throw error;
      }
      return (data as unknown as VisitRow[]).map(toStoredVisit);
    },
  });
}

/** The visits that took place in a class, newest first, as its teachers see them. */
export function classVisitsQuery(classSectionId: string) {
  return queryOptions({
    queryKey: classVisitsKey(classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<StoredVisit[]> => {
      const { data, error } = await getSupabase()
        .from('visits')
        .select(VISIT_COLUMNS)
        .eq('class_section_id', classSectionId)
        .eq('status', 'done')
        .order('visited_on', { ascending: false });
      if (error) {
        throw error;
      }
      return (data as unknown as VisitRow[]).map(toStoredVisit);
    },
  });
}

type SignalRow = {
  [
    Key in keyof Database['public']['Functions']['crp_class_signal']['Returns'][number]
  ]: Key extends
    | 'pulse_month'
    | 'last_visit_on'
    | 'check_back_on'
    | 'check_back_visit_id'
    | 'request_topic'
    | 'requested_at'
    ? string | null
    : Database['public']['Functions']['crp_class_signal']['Returns'][number][Key];
};

export function crpSignalQuery() {
  return queryOptions({
    queryKey: crpSignalKey(),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<ClassSignal[]> => {
      const { data, error } = await getSupabase().rpc('crp_class_signal');
      if (error) {
        throw error;
      }
      // A class without a Pulse, a visit or a request has these fields empty.
      return (data as SignalRow[]).map((row) => ({
        classSectionId: row.class_section_id,
        schoolId: row.school_id,
        grade: row.grade,
        section: row.section,
        medium: row.medium,
        pulseMonth: row.pulse_month ?? null,
        pulseChecked: row.pulse_checked,
        needsSupport: row.needs_support,
        hesitant: row.hesitant,
        fluent: row.fluent,
        englishNoResponse: row.english_no_response,
        toListen: row.to_listen,
        lastVisitOn: row.last_visit_on ?? null,
        visitsThisYear: row.visits_this_year,
        checkBackOn: row.check_back_on ?? null,
        checkBackVisitId: row.check_back_visit_id ?? null,
        requestTopic: row.request_topic ?? null,
        requestedAt: row.requested_at ?? null,
        marksToDiscuss: row.marks_to_discuss,
      }));
    },
  });
}

export interface StoredTask extends CrpTask {
  createdAt: string;
}

export function crpTasksQuery() {
  return queryOptions({
    queryKey: crpTasksKey(),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<StoredTask[]> => {
      const { data, error } = await getSupabase()
        .from('crp_tasks')
        .select('id, cluster_id, school_id, title, details, source, due_on, done_at, created_at')
        .order('due_on', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        clusterId: row.cluster_id,
        schoolId: row.school_id,
        title: row.title,
        details: row.details ?? '',
        source:
          row.source === 'circular' || row.source === 'meeting' || row.source === 'own'
            ? row.source
            : 'order',
        dueOn: row.due_on,
        done: row.done_at !== null,
        doneAt: row.done_at,
        removed: false,
        createdAt: row.created_at,
      }));
    },
  });
}

/** The schools of the signed-in CRP or teacher with their counts. */
export function schoolsOverviewQuery() {
  return queryOptions({
    queryKey: ['schools-overview'],
    meta: { persist: true },
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('my_schools_overview');
      if (error) {
        throw error;
      }
      return data;
    },
  });
}

export interface SchoolTeacher {
  id: string;
  fullName: string;
}

/** The teachers assigned to a school today. */
export function schoolTeachersQuery(schoolId: string) {
  return queryOptions({
    queryKey: ['school-teachers', schoolId],
    meta: { persist: true },
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SchoolTeacher[]> => {
      const today = todayInIndia();
      const { data, error } = await getSupabase()
        .from('staff_assignments')
        .select(
          'user_id, starts_on, ends_on, profiles!staff_assignments_user_id_fkey(full_name, is_active)',
        )
        .eq('school_id', schoolId)
        .eq('role', 'teacher')
        .lte('starts_on', today)
        .or(`ends_on.is.null,ends_on.gte.${today}`);
      if (error) {
        throw error;
      }
      const teachers = new Map<string, SchoolTeacher>();
      for (const row of data) {
        if (row.profiles.is_active) {
          teachers.set(row.user_id, { id: row.user_id, fullName: row.profiles.full_name });
        }
      }
      return [...teachers.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
  });
}

export interface ClassPulseCheck {
  checkId: string;
  studentId: string;
  childName: string;
  month: string;
  mode: 'recorded' | 'adapted';
  attempt: number;
  recordedAt: string;
  audioPath: string | null;
  audioAvailable: boolean;
  teacherReading: (typeof READING)[number];
  teacherEnglish: (typeof ENGLISH)[number];
  machine: {
    reading: (typeof READING)[number];
    english: (typeof ENGLISH)[number];
    unsure: boolean;
    wcpm: number | null;
  } | null;
  review: {
    reading: (typeof READING)[number];
    english: (typeof ENGLISH)[number];
    note: string;
  } | null;
}

/** Flags of a score that call for a person to listen. */
const UNSURE_FLAGS = ['low_confidence', 'no_speech', 'quiet'];

/**
 * Whether the CRP should listen to a recording: one not yet reviewed, still available, where the
 * engine was unsure, or where it and the teacher differ on reading or by two levels on English.
 * The cluster signal counts recordings by the same rule.
 */
export function needsListening(check: ClassPulseCheck): boolean {
  if (check.mode !== 'recorded' || !check.audioAvailable || check.review || !check.machine) {
    return false;
  }
  const english = new Set([check.teacherEnglish, check.machine.english]);
  return (
    check.machine.unsure ||
    check.machine.reading !== check.teacherReading ||
    (english.has('sentences') && english.has('no_response'))
  );
}

/** The latest attempt of every child checked in the class's current and previous Pulse month. */
export function classPulseChecksQuery(classSectionId: string) {
  return queryOptions({
    queryKey: classPulseChecksKey(classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<ClassPulseCheck[]> => {
      const today = todayInIndia();
      const lastMonth = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
      const { data, error } = await getSupabase()
        .from('pulse_checks')
        .select(
          'id, sample_id, student_id, mode, attempt, recorded_at, audio_path, audio_deleted_at, reading_level, english_level, students(full_name), pulse_samples!inner(pulse_cycles!inner(month)), pulse_scores(reading_level, english_level, flags, wcpm), pulse_reviews(reading_level, english_level, note)',
        )
        .eq('class_section_id', classSectionId)
        .gte('pulse_samples.pulse_cycles.month', lastMonth)
        .order('attempt', { ascending: false });
      if (error) {
        throw error;
      }
      const latest = new Map<string, ClassPulseCheck>();
      for (const row of data) {
        if (latest.has(row.sample_id)) {
          continue;
        }
        const score = row.pulse_scores;
        const review = row.pulse_reviews;
        latest.set(row.sample_id, {
          checkId: row.id,
          studentId: row.student_id,
          childName: row.students.full_name,
          month: row.pulse_samples.pulse_cycles.month,
          mode: row.mode === 'adapted' ? 'adapted' : 'recorded',
          attempt: row.attempt,
          recordedAt: row.recorded_at,
          audioPath: row.audio_path,
          audioAvailable: row.audio_path !== null && row.audio_deleted_at === null,
          teacherReading: oneOf(READING, row.reading_level, 'hesitant'),
          teacherEnglish: oneOf(ENGLISH, row.english_level, 'words'),
          machine: score
            ? {
                reading: oneOf(READING, score.reading_level, 'hesitant'),
                english: oneOf(ENGLISH, score.english_level, 'words'),
                unsure: score.flags.some((flag) => UNSURE_FLAGS.includes(flag)),
                wcpm: score.wcpm,
              }
            : null,
          review: review
            ? {
                reading: oneOf(READING, review.reading_level, 'hesitant'),
                english: oneOf(ENGLISH, review.english_level, 'words'),
                note: review.note ?? '',
              }
            : null,
        });
      }
      return [...latest.values()].sort(
        (a, b) => b.month.localeCompare(a.month) || a.childName.localeCompare(b.childName),
      );
    },
  });
}

/** The teachers assigned to a class; empty when it has none yet. */
export function classTeachersQuery(classSectionId: string) {
  return queryOptions({
    queryKey: ['class-teachers', classSectionId],
    meta: { persist: true },
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await getSupabase()
        .from('class_teachers')
        .select('teacher_id')
        .eq('class_section_id', classSectionId);
      if (error) {
        throw error;
      }
      return data.map((row) => row.teacher_id);
    },
  });
}

export interface OpenRequest {
  id: string;
  topic: 'reading' | 'english' | 'classroom' | 'other';
  note: string;
  createdAt: string;
  requestedBy: string | null;
}

/** The open request for a visit to a class, if any. */
export function openRequestQuery(classSectionId: string) {
  return queryOptions({
    queryKey: visitRequestsKey(classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<OpenRequest | null> => {
      const { data, error } = await getSupabase()
        .from('visit_requests')
        .select('id, topic, note, created_at, requested_by')
        .eq('class_section_id', classSectionId)
        .is('withdrawn_at', null)
        .is('answered_by_visit_id', null)
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }
      return {
        id: data.id,
        topic:
          data.topic === 'english' || data.topic === 'classroom' || data.topic === 'other'
            ? data.topic
            : 'reading',
        note: data.note ?? '',
        createdAt: data.created_at,
        requestedBy: data.requested_by,
      };
    },
  });
}

/** The working copies of visits on the device, kept current as they change. */
function useVisitDrafts(): VisitDraft[] {
  const queryClient = useQueryClient();
  const held = useRef<VisitDraft[]>([]);
  const subscribe = useCallback(
    (changed: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (matchQuery({ queryKey: ['visit-draft'] }, event.query)) {
          changed();
        }
      }),
    [queryClient],
  );
  // The same list while no copy changed, so that the page renders only when one does.
  const read = useCallback(() => {
    const drafts = draftsOf(queryClient);
    const previous = held.current;
    if (
      drafts.length === previous.length &&
      drafts.every((draft, index) => draft === previous[index])
    ) {
      return previous;
    }
    held.current = drafts;
    return drafts;
  }, [queryClient]);
  return useSyncExternalStore(subscribe, read);
}

/** The server's visits with the device's working copies over them; new ones are added. */
export function withDrafts(stored: readonly StoredVisit[], drafts: readonly VisitDraft[]): Visit[] {
  const shown = new Map<string, Visit>(stored.map((visit) => [visit.id, visit]));
  for (const draft of drafts) {
    shown.set(draft.visit.id, draft.visit);
  }
  return [...shown.values()];
}

/**
 * The cluster's visits as the device shows them: what the server holds, with the visits planned,
 * started or changed on this phone and not yet uploaded. Keeps the working copies in line with
 * the server's.
 */
export function useClusterVisits() {
  const queryClient = useQueryClient();
  rememberDraftQueries(queryClient);
  const query = useQuery(clusterVisitsQuery());
  const drafts = useVisitDrafts();
  const stored = query.data;
  useEffect(() => {
    if (stored) {
      reconcileDrafts(queryClient, stored);
    }
  }, [queryClient, stored]);
  const data = useMemo(
    () =>
      stored
        ? withDrafts(stored, drafts)
        : drafts.length > 0
          ? drafts.map((draft) => draft.visit)
          : undefined,
    [stored, drafts],
  );
  return {
    data,
    stored,
    isPending: data === undefined && query.isPending,
    isError: data === undefined && query.isError,
    refetch: query.refetch,
  };
}

export interface VisitState {
  /** The visit as the device shows it: its working copy, else the server's. */
  visit: Visit | null;
  /** The server's version, when the device holds it. */
  stored: StoredVisit | null;
  /** The device's working copy, when there is one. */
  draft: VisitDraft | null;
  /** Whether a save of the visit waits on the device, and whether it was refused. */
  waiting: ReturnType<typeof useWaitingChange>;
  isPending: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

/** A visit of the cluster as the device holds it. */
export function useVisit(visitId: string): VisitState {
  const queryClient = useQueryClient();
  const visits = useClusterVisits();
  // The working copy lives only in the cache (and its encrypted snapshot); nothing is fetched.
  const draft = useQuery<VisitDraft | null>({
    queryKey: visitDraftKey(visitId),
    queryFn: () => draftOf(queryClient, visitId) ?? null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const waiting = useWaitingChange(visitDedupeKey(visitId));
  const stored = visits.stored?.find((entry) => entry.id === visitId) ?? null;
  const visit = draft.data?.visit ?? stored;
  return {
    visit,
    stored,
    draft: draft.data ?? null,
    waiting,
    isPending: visits.isPending,
    isError: visits.isError,
    refetch: visits.refetch,
  };
}

/**
 * Saves a version of a visit on the device and sends it when it can. Resolves to whether it was
 * kept; when it could be neither kept nor sent, the person is told.
 */
/**
 * Runs a save that is kept on the device or sent. Should it be neither, what the screen showed at
 * once is put back, the person is told, and the result is false so that nothing typed is cleared.
 */
function useKeepChange() {
  const { t } = useTranslation();
  return useCallback(
    async (run: () => Promise<void>, undo: () => void): Promise<boolean> => {
      try {
        await run();
        return true;
      } catch {
        undo();
        toast.error(t('visits.visit.saveFailed'));
        return false;
      }
    },
    [t],
  );
}

export function useSaveVisit() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useCallback(
    async (visit: Visit, label: ClassLabel | null): Promise<boolean> => {
      const stored = queryClient
        .getQueryData<StoredVisit[]>(clusterVisitsKey())
        ?.find((entry) => entry.id === visit.id);
      const change = nextVisitChange(queryClient, visit, stored?.revision ?? null, label);
      try {
        await keepOrSend(visitSaveChange.kind, change, visitDedupeKey(visit.id), async () => {
          const sent = await sendVisit(change, getSupabase());
          visitSaveChange.onSent?.(change, sent, queryClient);
          for (const key of visitSaveChange.invalidates(change)) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        });
        return true;
      } catch {
        toast.error(t('visits.visit.saveFailed'));
        return false;
      }
    },
    [queryClient, t],
  );
}

/** Drops a planned visit. */
export function useRemovePlannedVisit() {
  const queryClient = useQueryClient();
  const keep = useKeepChange();
  return useCallback(
    async (change: VisitRemoveChange) => {
      const before = queryClient.getQueryData<StoredVisit[]>(clusterVisitsKey());
      // Shown as gone at once; the server follows.
      queryClient.setQueryData<StoredVisit[]>(clusterVisitsKey(), (visits) =>
        visits?.filter((entry) => entry.id !== change.visitId),
      );
      const kept = await keep(
        () =>
          keepOrSend(visitRemoveChange.kind, change, visitDedupeKey(change.visitId), async () => {
            await visitRemoveChange.send(change, {
              supabase: getSupabase(),
              readFile: () => Promise.reject(new Error('No files.')),
            });
            void queryClient.invalidateQueries({ queryKey: clusterVisitsKey() });
          }),
        () => queryClient.setQueryData(clusterVisitsKey(), before),
      );
      if (kept) {
        discardDraft(queryClient, change.visitId);
      }
      return kept;
    },
    [queryClient, keep],
  );
}

/** Saves a task (or its removal) on the device and shows it at once. */
export function useSaveTask() {
  const queryClient = useQueryClient();
  const keep = useKeepChange();
  return useCallback(
    async (task: CrpTask) => {
      const before = queryClient.getQueryData<StoredTask[]>(crpTasksKey());
      queryClient.setQueryData<StoredTask[]>(crpTasksKey(), (tasks) => {
        const others = (tasks ?? []).filter((entry) => entry.id !== task.id);
        if (task.removed) {
          return others;
        }
        const createdAt =
          tasks?.find((entry) => entry.id === task.id)?.createdAt ?? new Date().toISOString();
        return [...others, { ...task, createdAt }];
      });
      return keep(
        () =>
          keepOrSend(taskChange.kind, task, taskDedupeKey(task.id), async () => {
            await taskChange.send(task, {
              supabase: getSupabase(),
              readFile: () => Promise.reject(new Error('No files.')),
            });
            void queryClient.invalidateQueries({ queryKey: crpTasksKey() });
          }),
        () => queryClient.setQueryData(crpTasksKey(), before),
      );
    },
    [queryClient, keep],
  );
}

/** Saves the CRP's review of a recording and shows it at once. */
export function useSaveReview() {
  const queryClient = useQueryClient();
  const keep = useKeepChange();
  return useCallback(
    async (review: PulseReviewChange) => {
      const before = queryClient.getQueryData<ClassPulseCheck[]>(
        classPulseChecksKey(review.classSectionId),
      );
      queryClient.setQueryData<ClassPulseCheck[]>(
        classPulseChecksKey(review.classSectionId),
        (checks) =>
          checks?.map((check) =>
            check.checkId === review.checkId
              ? {
                  ...check,
                  review: {
                    reading: review.readingLevel,
                    english: review.englishLevel,
                    note: review.note,
                  },
                }
              : check,
          ),
      );
      return keep(
        () =>
          keepOrSend(pulseReviewChange.kind, review, reviewDedupeKey(review.checkId), async () => {
            await pulseReviewChange.send(review, {
              supabase: getSupabase(),
              readFile: () => Promise.reject(new Error('No files.')),
            });
            void queryClient.invalidateQueries({
              queryKey: classPulseChecksKey(review.classSectionId),
            });
          }),
        () => queryClient.setQueryData(classPulseChecksKey(review.classSectionId), before),
      );
    },
    [queryClient, keep],
  );
}

/** A teacher's request for a visit, or its withdrawal. */
export function useSaveRequest() {
  const queryClient = useQueryClient();
  const keep = useKeepChange();
  return useCallback(
    (request: VisitRequestChange) =>
      keep(
        () =>
          keepOrSend(
            visitRequestChange.kind,
            request,
            requestDedupeKey(request.classSectionId),
            async () => {
              await visitRequestChange.send(request, {
                supabase: getSupabase(),
                readFile: () => Promise.reject(new Error('No files.')),
              });
              void queryClient.invalidateQueries({
                queryKey: visitRequestsKey(request.classSectionId),
              });
            },
          ),
        // Nothing was shown before the request was kept.
        () => undefined,
      ),
    [queryClient, keep],
  );
}

export interface StoredNote {
  audioPath: string;
  durationMs: number;
  recordedAt: string;
  audioAvailable: boolean;
  transcript: string | null;
  transcribedAt: string | null;
}

/** The CRP's voice note of a visit as the server holds it, with its transcript when written. */
export function visitNoteQuery(visitId: string) {
  return queryOptions({
    queryKey: visitNoteKey(visitId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<StoredNote | null> => {
      const { data, error } = await getSupabase()
        .from('visit_notes')
        .select(
          'audio_path, duration_ms, recorded_at, audio_deleted_at, transcript, transcribed_at',
        )
        .eq('visit_id', visitId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data
        ? {
            audioPath: data.audio_path,
            durationMs: data.duration_ms,
            recordedAt: data.recorded_at,
            audioAvailable: data.audio_deleted_at === null,
            transcript: data.transcript,
            transcribedAt: data.transcribed_at,
          }
        : null;
    },
  });
}

/**
 * Keeps a voice note on the device, encrypted, and saves the visit so that the note is uploaded
 * with it. Throws when the device cannot keep files (for example in private browsing).
 */
export function useKeepVoiceNote() {
  const queryClient = useQueryClient();
  const save = useSaveVisit();
  return useCallback(
    async (
      visit: Visit,
      recording: { blob: Blob; durationMs: number; contentType: VoiceNote['contentType'] },
      language: VoiceNote['language'],
      label: ClassLabel | null,
    ) => {
      const fileId = await offlineRuntime.storeFile(recording.blob);
      const stored = queryClient
        .getQueryData<StoredVisit[]>(clusterVisitsKey())
        ?.find((entry) => entry.id === visit.id);
      attachNote(queryClient, visit, stored?.revision ?? null, {
        noteId: crypto.randomUUID(),
        fileId,
        contentType: recording.contentType,
        durationMs: Math.max(1000, Math.round(recording.durationMs)),
        language,
        recordedAt: new Date().toISOString(),
      });
      await save(draftOf(queryClient, visit.id)?.visit ?? visit, label);
    },
    [queryClient, save],
  );
}
