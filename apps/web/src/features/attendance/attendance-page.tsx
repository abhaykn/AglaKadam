import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  Save,
  UserX,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import type { OutboxError } from '@/features/offline/device-store';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import { reasonFor } from '@/features/offline/sync-reasons';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { cn } from '@/lib/cn';
import { pulseCycleQuery } from '@/features/pulse/pulse-api';
import { useWaitingPulse } from '@/features/pulse/use-waiting-pulse';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import {
  ATTENDANCE_WINDOW_DAYS,
  attendanceChange,
  nextSaveIdentity,
  ownSavesOf,
  attendanceDaysQuery,
  attendanceDedupeKey,
  classDetailsQuery,
  classRosterQuery,
  rollOn,
  saveAttendance,
  STALE_ATTENDANCE,
  type AttendanceChange,
  type AttendanceDay,
  type ClassDetails,
  type RosterEntry,
} from './attendance-api';
import { addDays, formatDay } from './dates';

interface DayState {
  waitingId: string | null;
  waitingState: 'pending' | 'failed' | null;
  waitingError: OutboxError | null;
  recorded: AttendanceDay | undefined;
  recordUnknown: boolean;
}

function DayStatus({ state }: { state: DayState }) {
  const { t } = useTranslation();
  const { waitingId, waitingState, waitingError, recorded, recordUnknown } = state;

  if (waitingState === 'failed' && waitingError?.code === STALE_ATTENDANCE) {
    return (
      <Alert tone="warning" title={t('attendance.status.staleTitle')}>
        <p>
          {recorded
            ? t('attendance.status.staleBody', {
                present: recorded.presentCount,
                total: recorded.enrolledCount,
              })
            : t('attendance.status.staleBodyUnknown')}
        </p>
        {waitingId ? (
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            onClick={() => {
              offlineRuntime.discard(waitingId).catch(() => toast.error(t('sync.actionFailed')));
            }}
          >
            {t('attendance.useSavedVersion')}
          </Button>
        ) : null}
      </Alert>
    );
  }
  if (waitingState === 'failed') {
    return (
      <Alert tone="danger" title={t('attendance.status.failedTitle')}>
        {waitingError ? reasonFor(waitingError, t) : null} {t('attendance.status.failedHint')}
      </Alert>
    );
  }
  if (waitingState === 'pending') {
    return (
      <p className="flex items-center gap-2 text-sm text-warning">
        <CloudUpload className="size-4 shrink-0" aria-hidden="true" />
        {t('attendance.status.waiting')}
      </p>
    );
  }
  if (recorded) {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <CloudCheck className="size-4 shrink-0" aria-hidden="true" />
        {t('attendance.status.uploaded', {
          present: recorded.presentCount,
          total: recorded.enrolledCount,
        })}
      </p>
    );
  }
  return (
    <p className="text-sm text-fg-muted">
      {recordUnknown ? t('attendance.status.unknown') : t('attendance.status.notMarked')}
    </p>
  );
}

interface AttendanceFormProps {
  details: ClassDetails;
  date: string;
  roll: RosterEntry[];
  baseline: string[];
  /** The server version the next save builds on (see `AttendanceChange.baseUpdatedAt`). */
  baseUpdatedAt: string | null;
  /** This device's save of the day that is still waiting, which the next save replaces. */
  previous: AttendanceChange | null;
  day: DayState;
}

function AttendanceForm({
  details,
  date,
  roll,
  baseline,
  baseUpdatedAt,
  previous,
  day,
}: AttendanceFormProps) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  // Only what the teacher changed is held here; everything else follows the saved record.
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [isSaving, setSaving] = useState(false);
  const baselineAbsent = useMemo(() => new Set(baseline), [baseline]);
  const isAbsent = (studentId: string) => changes[studentId] ?? baselineAbsent.has(studentId);
  const absentCount = roll.filter((entry) => isAbsent(entry.studentId)).length;
  const isDirty = roll.some(
    (entry) =>
      changes[entry.studentId] !== undefined &&
      changes[entry.studentId] !== baselineAbsent.has(entry.studentId),
  );
  const hasRecord = day.recorded !== undefined || day.waitingState !== null;
  // A version that was not accepted can be saved again as it is, after review.
  const canSave = isDirty || !hasRecord || day.waitingState === 'failed';

  const blocker = useBlocker({
    // While a save is running, leaving would lose the marks if it then failed.
    shouldBlockFn: () => isDirty || isSaving,
    enableBeforeUnload: () => isDirty || isSaving,
    withResolver: true,
  });

  const toggle = (studentId: string) => {
    setChanges((previous) => ({ ...previous, [studentId]: !isAbsent(studentId) }));
  };

  const markEveryonePresent = () => {
    setChanges(Object.fromEntries(roll.map((entry) => [entry.studentId, false])));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { queued } = await saveAttendance(
        {
          classSectionId: details.id,
          date,
          absentStudentIds: roll
            .filter((entry) => isAbsent(entry.studentId))
            .map((entry) => entry.studentId),
          ...nextSaveIdentity(previous, ownSavesOf(queryClient, details.id, date)),
          baseUpdatedAt,
          classLabel: { grade: details.grade, section: details.section },
        },
        queryClient,
      );
      setChanges({});
      toast.success(
        !queued
          ? t('attendance.saved')
          : isOnline
            ? t('attendance.savedUploading')
            : t('attendance.savedOnDevice'),
      );
    } catch (error) {
      toast.error(
        error instanceof ChangeRejectedError
          ? t('attendance.staleDirect')
          : isOnline
            ? t('attendance.saveFailed')
            : t('attendance.saveNeedsNetwork'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <p className="text-sm text-fg tabular-nums" aria-live="polite">
            {t('attendance.summary', {
              present: roll.length - absentCount,
              absent: absentCount,
              total: roll.length,
            })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={markEveryonePresent}
            disabled={isSaving}
            leadingIcon={<Users aria-hidden="true" />}
          >
            {t('attendance.markAllPresent')}
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {roll.map((entry) => {
            const absent = isAbsent(entry.studentId);
            return (
              <li key={entry.studentId}>
                <button
                  type="button"
                  // The name stays the same; whether the child is marked absent is the pressed state.
                  aria-pressed={absent}
                  aria-label={t('attendance.markAbsent', { name: entry.fullName })}
                  disabled={isSaving}
                  onClick={() => toggle(entry.studentId)}
                  className={cn(
                    'flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors disabled:opacity-70',
                    absent ? 'bg-danger-soft/60 hover:bg-danger-soft' : 'hover:bg-surface-sunken',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{entry.fullName}</span>
                    <span className="block text-xs text-fg-muted tabular-nums">
                      {entry.studentCode}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
                      absent ? 'bg-danger text-white' : 'bg-success-soft text-success',
                    )}
                    aria-hidden="true"
                  >
                    {absent ? <UserX className="size-4" /> : <Check className="size-4" />}
                    {absent ? t('attendance.absent') : t('attendance.present')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-canvas/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button
          size="lg"
          className="w-full"
          isLoading={isSaving}
          disabled={!canSave}
          onClick={() => void save()}
          leadingIcon={<Save aria-hidden="true" />}
        >
          {canSave
            ? day.waitingState === 'failed' && !isDirty
              ? t('attendance.saveAgain')
              : t('attendance.save')
            : t('attendance.noChanges')}
        </Button>
      </div>

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) {
            blocker.reset?.();
          }
        }}
      >
        <DialogContent title={t('attendance.leaveTitle')} description={t('attendance.leaveBody')}>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row-reverse">
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              {t('attendance.keepEditing')}
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t('attendance.leaveWithoutSaving')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DateNavigation({ classSectionId, date }: { classSectionId: string; date: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const today = todayInIndia();
  const earliest = addDays(today, -ATTENDANCE_WINDOW_DAYS);
  const go = (next: string) =>
    void navigate({
      to: '/app/attendance/$classId',
      params: { classId: classSectionId },
      search: { date: next },
      replace: true,
    });

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={t('attendance.previousDay')}
        disabled={date <= earliest}
        onClick={() => go(addDays(date, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <label className="relative inline-flex items-center gap-2 rounded-[0.625rem] border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg">
        <CalendarDays className="size-4 text-fg-muted" aria-hidden="true" />
        <span>{date === today ? t('attendance.todayLabel') : formatDay(date, i18n.language)}</span>
        <input
          type="date"
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={t('attendance.chooseDate')}
          value={date}
          min={earliest}
          max={today}
          onChange={(event) => {
            const next = event.target.value;
            if (next >= earliest && next <= today) {
              go(next);
            }
          }}
        />
      </label>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={t('attendance.nextDay')}
        disabled={date >= today}
        onClick={() => go(addDays(date, 1))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Marking one class's attendance for one day; works the same with or without a network. */
export function AttendancePage({ classSectionId, date }: { classSectionId: string; date: string }) {
  const { t } = useTranslation();
  const localise = useLocalisedName();
  const isOnline = useOnlineStatus();
  const details = useQuery(classDetailsQuery(classSectionId));
  const roster = useQuery(classRosterQuery(classSectionId));
  const days = useQuery(attendanceDaysQuery(classSectionId));
  const waiting = useWaitingChange(attendanceDedupeKey(classSectionId, date));
  useDocumentTitle(t('attendance.title'));

  const roll = useMemo(() => rollOn(roster.data ?? [], date), [roster.data, date]);
  const waitingChange = useMemo(() => {
    const parsed = attendanceChange.schema.safeParse(waiting.payload);
    return parsed.success ? parsed.data : null;
  }, [waiting.payload]);
  const recorded = days.data?.[date];
  // Children already marked absent for Pulse that day start as absent while the day has no record,
  // so that the register and Pulse agree. Read from the device only; the register never waits for
  // Pulse to load.
  const pulse = useQuery({ ...pulseCycleQuery(classSectionId), enabled: false });
  const waitingPulse = useWaitingPulse(classSectionId);
  const pulseAbsent = useMemo(() => {
    const children = pulse.data?.children ?? [];
    const marked = new Set(
      waitingPulse.absences
        .filter((entry) => entry.change.date === date && entry.state !== 'failed')
        .map((entry) => entry.change.sampleId),
    );
    // A child recorded that day was in school after all, whatever was marked earlier.
    const recorded = new Set([
      ...children
        .filter((child) =>
          child.checks.some((check) => todayInIndia(new Date(check.recordedAt)) === date),
        )
        .map((child) => child.sampleId),
      ...waitingPulse.checks
        .filter((entry) => todayInIndia(new Date(entry.change.recordedAt)) === date)
        .map((entry) => entry.change.sampleId),
    ]);
    return children
      .filter((child) => child.absences.includes(date) || marked.has(child.sampleId))
      .filter((child) => !recorded.has(child.sampleId))
      .map((child) => child.studentId);
  }, [pulse.data, waitingPulse.absences, waitingPulse.checks, date]);
  const baseline = useMemo(
    () => waitingChange?.absentStudentIds ?? recorded?.absentStudentIds ?? pulseAbsent,
    [waitingChange, recorded, pulseAbsent],
  );
  // An unsent version builds on what it was based on; one that was refused because the day moved
  // on is reviewed against, and then saved on top of, the server's current version.
  const isStale = waiting.state === 'failed' && waiting.error?.code === STALE_ATTENDANCE;
  const baseUpdatedAt =
    waitingChange && !isStale ? waitingChange.baseUpdatedAt : (recorded?.updatedAt ?? null);

  const title = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('attendance.title');

  // Without a network, data that was never kept on this device cannot load; say so plainly
  // instead of showing a loading screen that never ends.
  const cannotLoad = (query: { data: unknown; isError: boolean; fetchStatus: string }) =>
    query.data === undefined && (query.isError || query.fetchStatus === 'paused' || !isOnline);
  const isUnavailableOffline = cannotLoad(details) || cannotLoad(roster);

  const day: DayState = {
    waitingId: waiting.id,
    waitingState: waiting.state,
    waitingError: waiting.error,
    recorded,
    recordUnknown: days.data === undefined,
  };

  return (
    <div className="container-page space-y-5 py-8">
      <Link
        to="/app/teacher"
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('attendance.backToClasses')}
      </Link>
      <PageHeader
        title={title}
        description={
          details.data
            ? t('attendance.description', { school: localise(details.data.school) })
            : undefined
        }
        actions={<DateNavigation classSectionId={classSectionId} date={date} />}
      />
      {isUnavailableOffline && !isOnline ? (
        <EmptyState
          icon={CloudOff}
          title={t('attendance.noRoster.title')}
          description={t('attendance.noRoster.body')}
        />
      ) : (
        <QueryState
          isPending={details.isPending || roster.isPending || !waiting.isLoaded}
          isError={(details.isError && !details.data) || (roster.isError && !roster.data)}
          onRetry={() => {
            void details.refetch();
            void roster.refetch();
          }}
        >
          {details.data === null ? (
            <EmptyState icon={CircleAlert} title={t('attendance.classNotFound')} />
          ) : roll.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('attendance.emptyRoll.title')}
              description={t('attendance.emptyRoll.body')}
            />
          ) : details.data ? (
            <div className="space-y-4">
              <DayStatus state={day} />
              <AttendanceForm
                key={date}
                details={details.data}
                date={date}
                roll={roll}
                baseline={baseline}
                baseUpdatedAt={baseUpdatedAt}
                previous={waitingChange}
                day={day}
              />
            </div>
          ) : null}
        </QueryState>
      )}
    </div>
  );
}
