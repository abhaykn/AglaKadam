import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CalendarClock,
  ChevronLeft,
  CircleAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  Cpu,
  EyeOff,
  FileSignature,
  HandHeart,
  LockKeyhole,
  Mic,
  QrCode,
  RefreshCcw,
  Repeat,
  UserX,
  Users,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { classDetailsQuery, classRosterQuery } from '@/features/attendance/attendance-api';
import { addDays, formatDay } from '@/features/attendance/dates';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { reasonFor } from '@/features/offline/sync-reasons';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import {
  lockedWeeks,
  markPulseAbsent,
  monthEndOf,
  pulseCycleQuery,
  unlockWeek,
  viewOn,
  type PulseChild,
  type PulseWeek,
} from './pulse-api';
import { QrScanner } from './qr-scanner';
import { progressOf, statusOf, type WaitingAbsence, type WaitingCheck } from './pulse-status';
import { useWaitingPulse } from './use-waiting-pulse';
import { useWithdrawnConsent } from './use-withdrawn-consent';

interface ChildRowProps {
  child: PulseChild;
  /** The family has withdrawn consent for audio checks: the child is not recorded. */
  consentWithdrawn: boolean;
  classSectionId: string;
  classLabelValue: { grade: number; section: string };
  today: string;
  waitingChecks: WaitingCheck[];
  waitingAbsences: WaitingAbsence[];
}

function ChildRow({
  child,
  consentWithdrawn,
  classSectionId,
  classLabelValue,
  today,
  waitingChecks,
  waitingAbsences,
}: ChildRowProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [isMarking, setMarking] = useState(false);
  const status = statusOf(child, today, waitingChecks, waitingAbsences);

  const markAbsent = async () => {
    setMarking(true);
    try {
      await markPulseAbsent(
        {
          sampleId: child.sampleId,
          classSectionId,
          date: today,
          childName: child.name,
          classLabel: classLabelValue,
        },
        queryClient,
      );
      toast.success(t('pulse.absentSaved', { name: child.name }));
    } catch {
      toast.error(isOnline ? t('pulse.absentFailed') : t('pulse.needsNetwork'));
    } finally {
      setMarking(false);
    }
  };

  const recordLink = (attempt: 1 | 2, label: string, icon: ReactNode, secondary = false) => (
    <Button asChild size="sm" variant={secondary ? 'secondary' : 'primary'}>
      <Link
        to="/app/pulse/$classId/record/$sampleId"
        params={{ classId: classSectionId, sampleId: child.sampleId }}
        search={{ attempt }}
      >
        {icon}
        {label}
      </Link>
    </Button>
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium text-fg">{child.name || t('pulse.unnamedChild')}</p>
        <p className="text-xs text-fg-muted tabular-nums">{child.studentCode}</p>
        <div className="flex flex-wrap gap-1.5">
          {child.replacesSampleId ? (
            <Badge tone="info">{t('pulse.badge.replacement')}</Badge>
          ) : null}
          {child.adapted ? <Badge tone="info">{t('pulse.badge.adapted')}</Badge> : null}
          {consentWithdrawn && status.kind !== 'replaced' ? (
            <Badge tone="warning">{t('pulse.badge.consentWithdrawn')}</Badge>
          ) : null}
          {status.kind === 'due' ? (
            <>
              {status.late ? (
                <Badge tone="warning">
                  {t('pulse.badge.late', { date: formatDay(child.dueOn, i18n.language) })}
                </Badge>
              ) : (
                <Badge>
                  {t('pulse.badge.dueBy', { date: formatDay(child.dueOn, i18n.language) })}
                </Badge>
              )}
              {status.absentToday ? (
                <Badge tone="neutral">
                  <UserX aria-hidden="true" />
                  {t('pulse.badge.absentToday')}
                </Badge>
              ) : null}
              {child.absences.length > 0 && !status.absentToday ? (
                <Badge tone="neutral">
                  {t('pulse.badge.absentDays', { count: child.absences.length })}
                </Badge>
              ) : null}
            </>
          ) : null}
          {status.kind === 'recorded' ? (
            <>
              {status.first.where === 'server' ? (
                <Badge tone="success">
                  <CloudCheck aria-hidden="true" />
                  {t('pulse.badge.uploaded')}
                </Badge>
              ) : status.first.where === 'device' ? (
                <Badge tone="warning">
                  <CloudUpload aria-hidden="true" />
                  {t('pulse.badge.onDevice')}
                </Badge>
              ) : (
                <Badge tone="danger">{t('pulse.badge.refused')}</Badge>
              )}
              {status.first.classroom === 'noisy' ? (
                <Badge tone="neutral">{t('pulse.badge.noisy')}</Badge>
              ) : null}
              {status.secondRecorded ? (
                <Badge tone="neutral">{t('pulse.badge.recordedTwice')}</Badge>
              ) : null}
            </>
          ) : null}
          {status.kind === 'replaced' ? (
            <Badge tone="neutral">
              {status.reason === 'left'
                ? t('pulse.badge.replacedLeft')
                : status.reason === 'consent'
                  ? t('pulse.badge.replacedConsent')
                  : t('pulse.badge.replacedAbsent')}
            </Badge>
          ) : null}
        </div>
        {status.kind === 'due' && consentWithdrawn ? (
          <p className="text-sm text-fg-muted">{t('pulse.consentWithdrawnHint')}</p>
        ) : null}
        {status.kind === 'recorded' && status.first.mode === 'recorded' ? (
          <MachineSummary child={child} uploaded={status.first.where === 'server'} today={today} />
        ) : null}
        {status.kind === 'recorded' &&
        status.first.mode === 'recorded' &&
        status.first.classroom === 'noisy' &&
        status.first.where === 'device' &&
        !status.secondRecorded &&
        !consentWithdrawn ? (
          <p className="text-sm text-fg-muted">{t('pulse.retakeAfterUpload')}</p>
        ) : null}
        {status.kind === 'recorded'
          ? [status.first.waiting, status.secondWaiting].map((waiting) =>
              waiting?.error ? (
                <p
                  key={waiting.outboxId}
                  className={cn(
                    'text-sm',
                    waiting.state === 'failed' ? 'text-danger' : 'text-fg-muted',
                  )}
                >
                  {reasonFor(waiting.error, t)}{' '}
                  {waiting.state === 'failed' ? t('pulse.refusedHint') : t('pulse.retryingHint')}
                </p>
              ) : null,
            )
          : null}
      </div>

      {status.kind === 'due' && !consentWithdrawn ? (
        <div className="flex flex-wrap gap-2">
          {status.absentToday || status.late ? null : (
            <Button
              size="sm"
              variant="secondary"
              isLoading={isMarking}
              onClick={() => void markAbsent()}
              leadingIcon={<UserX aria-hidden="true" />}
            >
              {t('pulse.absentToday')}
            </Button>
          )}
          {child.adapted
            ? recordLink(1, t('pulse.adapted.open'), <HandHeart aria-hidden="true" />)
            : recordLink(1, t('pulse.record'), <Mic aria-hidden="true" />)}
        </div>
      ) : status.kind === 'recorded' && status.canRetake && !consentWithdrawn ? (
        recordLink(2, t('pulse.recordAgain'), <Repeat aria-hidden="true" />, true)
      ) : null}
    </li>
  );
}

/** After this many days without a score, the engine could not score the recording. */
const WAITING_FOR_SCORE_DAYS = 3;

/**
 * What the speech engine measured in the child's latest recording, or that it will do so tonight.
 * The engine's levels use the teacher's scales, as a second opinion beside the teacher's own.
 */
function MachineSummary({
  child,
  uploaded,
  today,
}: {
  child: PulseChild;
  uploaded: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  const latest = [...child.checks].reverse().find((check) => check.mode === 'recorded');
  const score = latest?.score ?? null;
  if (!score) {
    const recent =
      latest !== undefined &&
      todayInIndia(new Date(latest.recordedAt)) >= addDays(today, -WAITING_FOR_SCORE_DAYS);
    return uploaded && recent ? (
      <p className="text-sm text-fg-muted">{t('pulse.machine.waiting')}</p>
    ) : null;
  }
  const parts = [
    t('pulse.machine.summary', {
      reading: t(`pulse.machine.reading.${score.readingLevel}`),
      english: t(`pulse.machine.english.${score.englishLevel}`),
    }),
  ];
  if (score.wcpm !== null) {
    parts.push(t('pulse.machine.wcpm', { count: Math.round(score.wcpm) }));
  }
  if (score.uncertain) {
    parts.push(t('pulse.machine.uncertain'));
  }
  return (
    <p className="flex items-start gap-1.5 text-sm text-fg-muted">
      <Cpu className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{parts.join(' · ')}</span>
    </p>
  );
}

/**
 * A week that has opened while this phone had no network: its children are on the phone, still
 * encrypted. The CRP's QR code unlocks them during a visit.
 */
function LockedWeek({ classSectionId, week }: { classSectionId: string; week: PulseWeek }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);
  // The camera reads the same code several times a second; each code is answered once.
  const lastCode = useRef<string | null>(null);

  const openScanner = (open: boolean) => {
    lastCode.current = null;
    setScanning(open);
  };

  const handleCode = async (text: string) => {
    if (busy.current || text === lastCode.current) {
      return;
    }
    busy.current = true;
    lastCode.current = text;
    try {
      const outcome = await unlockWeek(queryClient, classSectionId, text);
      if (outcome.kind === 'unlocked') {
        openScanner(false);
        toast.success(t('pulse.unlock.done', { week: outcome.week, count: outcome.children }));
      } else if (outcome.kind !== 'not-a-code') {
        toast.error(t(`pulse.unlock.${outcome.kind}`));
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex min-w-0 gap-3">
        <LockKeyhole className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-fg">{t('pulse.unlock.title', { week: week.week })}</p>
          <p className="text-sm text-fg-muted">
            {week.batch ? t('pulse.unlock.body') : t('pulse.unlock.notOnDevice')}
          </p>
        </div>
      </div>
      {week.batch ? (
        <Button
          variant="secondary"
          onClick={() => openScanner(true)}
          leadingIcon={<QrCode aria-hidden="true" />}
        >
          {t('pulse.unlock.scan')}
        </Button>
      ) : null}
      <Dialog open={scanning} onOpenChange={openScanner}>
        <DialogContent
          title={t('pulse.unlock.scanTitle', { week: week.week })}
          description={t('pulse.unlock.scanBody')}
        >
          {scanning ? <QrScanner onCode={(text) => void handleCode(text)} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** The month's Pulse of one class: the children due now and those already recorded. */
export function PulsePage({ classSectionId }: { classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const localise = useLocalisedName();
  const isOnline = useOnlineStatus();
  const details = useQuery(classDetailsQuery(classSectionId));
  const pulse = useQuery(pulseCycleQuery(classSectionId));
  // Kept on the device too: a week unlocked with the CRP's code names its children from it.
  useQuery(classRosterQuery(classSectionId));
  const waiting = useWaitingPulse(classSectionId);
  const today = todayInIndia();
  useDocumentTitle(t('pulse.title'));

  const title = details.data
    ? t('pulse.titleFor', { class: classLabel(t, details.data.grade, details.data.section) })
    : t('pulse.title');
  const cannotLoad = (query: { data: unknown; isError: boolean; fetchStatus: string }) =>
    query.data === undefined && (query.isError || query.fetchStatus === 'paused' || !isOnline);
  const isUnavailableOffline = cannotLoad(details) || cannotLoad(pulse);
  const view = pulse.data ? viewOn(pulse.data, today) : undefined;
  const cycle = view?.cycle ?? null;
  // A cycle kept on the device from an earlier month is over; only this month's can be recorded.
  const isCurrent = cycle !== null && today <= monthEndOf(cycle.month);

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
            ? t('pulse.description', { school: localise(details.data.school) })
            : undefined
        }
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link to="/app/pulse/$classId/consent" params={{ classId: classSectionId }}>
                <FileSignature aria-hidden="true" />
                {t('pulse.consentLink')}
              </Link>
            </Button>
            {isOnline ? (
              <Button
                variant="secondary"
                size="sm"
                isLoading={pulse.isFetching}
                onClick={() => void pulse.refetch()}
                leadingIcon={<RefreshCcw aria-hidden="true" />}
              >
                {t('pulse.refresh')}
              </Button>
            ) : null}
          </>
        }
      />
      {isUnavailableOffline && !isOnline ? (
        <EmptyState
          icon={CloudOff}
          title={t('pulse.notOnDevice.title')}
          description={t('pulse.notOnDevice.body')}
        />
      ) : (
        <QueryState
          isPending={details.isPending || pulse.isPending || !waiting.isLoaded}
          isError={(details.isError && !details.data) || (pulse.isError && !pulse.data)}
          onRetry={() => {
            void details.refetch();
            void pulse.refetch();
          }}
        >
          {details.data === null ? (
            <EmptyState icon={CircleAlert} title={t('attendance.classNotFound')} />
          ) : details.data && details.data.grade >= 1 && details.data.grade <= 3 ? (
            view && cycle && isCurrent ? (
              <PulseCycleContent
                classSectionId={classSectionId}
                classLabelValue={{ grade: details.data.grade, section: details.data.section }}
                today={today}
                language={i18n.language}
                waitingChecks={waiting.checks}
                waitingAbsences={waiting.absences}
              />
            ) : (
              <EmptyState
                icon={CalendarClock}
                title={t('pulse.notStarted.title')}
                description={t('pulse.notStarted.body')}
                action={
                  <Button asChild>
                    <Link to="/app/pulse/$classId/consent" params={{ classId: classSectionId }}>
                      <FileSignature aria-hidden="true" />
                      {t('pulse.recordConsent')}
                    </Link>
                  </Button>
                }
              />
            )
          ) : details.data ? (
            <EmptyState
              icon={Users}
              title={t('pulse.notForGrade.title')}
              description={t('pulse.notForGrade.body')}
            />
          ) : null}
        </QueryState>
      )}
    </div>
  );
}

interface PulseCycleContentProps {
  classSectionId: string;
  classLabelValue: { grade: number; section: string };
  today: string;
  language: string;
  waitingChecks: WaitingCheck[];
  waitingAbsences: WaitingAbsence[];
}

function PulseCycleContent({
  classSectionId,
  classLabelValue,
  today,
  language,
  waitingChecks,
  waitingAbsences,
}: PulseCycleContentProps) {
  const { t } = useTranslation();
  const { data } = useQuery(pulseCycleQuery(classSectionId));
  const withdrawn = useWithdrawnConsent(classSectionId);
  const view = data ? viewOn(data, today) : undefined;
  if (!view?.cycle) {
    return null;
  }
  const { cycle } = view;
  const progress = progressOf(view, today, waitingChecks, waitingAbsences);
  const month = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${cycle.month}T00:00:00Z`));
  const subject = t('pulse.subject', {
    language: cycle.language === 'hi' ? t('pulse.language.hi') : t('pulse.language.en'),
  });
  const locked = lockedWeeks(view, today);
  const rowProps = { classSectionId, classLabelValue, today, waitingChecks, waitingAbsences };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="space-y-1">
            <p className="text-sm text-fg-muted">{t('pulse.monthLabel', { month })}</p>
            <p className="text-lg font-semibold text-fg">{subject}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-fg tabular-nums">
              {t('pulse.progressCount', { recorded: progress.recorded, target: progress.target })}
            </p>
            <p className="text-sm text-fg-muted">{t('pulse.progressLabel')}</p>
          </div>
        </div>
        <div
          className="mx-5 mb-4 h-2 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.target}
          aria-valuenow={progress.recorded}
          aria-label={t('pulse.progressLabel')}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{
              width: `${String(progress.target > 0 ? Math.min(100, (progress.recorded / progress.target) * 100) : 0)}%`,
            }}
          />
        </div>
      </Card>

      <Alert tone="info">{t('pulse.fairnessNote')}</Alert>

      {locked.map((week) => (
        <LockedWeek key={week.week} classSectionId={classSectionId} week={week} />
      ))}

      <Card aria-labelledby="pulse-due">
        <CardHeader
          titleId="pulse-due"
          title={t('pulse.dueTitle')}
          description={t('pulse.dueBody')}
        />
        {progress.due.length === 0 ? (
          <EmptyState
            icon={CloudCheck}
            title={t('pulse.nothingDue.title')}
            description={
              progress.hidden > 0 ? t('pulse.nothingDue.bodyMore') : t('pulse.nothingDue.bodyDone')
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {progress.due.map((child) => (
              <ChildRow
                key={child.sampleId}
                child={child}
                consentWithdrawn={!child.adapted && withdrawn.has(child.studentId)}
                {...rowProps}
              />
            ))}
          </ul>
        )}
      </Card>

      {progress.hidden > 0 ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <EyeOff className="size-4 shrink-0" aria-hidden="true" />
          {t('pulse.hidden', { count: progress.hidden })}
        </p>
      ) : null}

      {progress.recordedChildren.length > 0 ? (
        <Card aria-labelledby="pulse-recorded">
          <CardHeader titleId="pulse-recorded" title={t('pulse.recordedTitle')} />
          <ul className="divide-y divide-border">
            {progress.recordedChildren.map((child) => (
              <ChildRow
                key={child.sampleId}
                child={child}
                consentWithdrawn={!child.adapted && withdrawn.has(child.studentId)}
                {...rowProps}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {progress.replaced.length > 0 ? (
        <Card aria-labelledby="pulse-replaced">
          <CardHeader
            titleId="pulse-replaced"
            title={t('pulse.replacedTitle')}
            description={t('pulse.replacedBody')}
          />
          <ul className="divide-y divide-border">
            {progress.replaced.map((child) => (
              <ChildRow
                key={child.sampleId}
                child={child}
                consentWithdrawn={!child.adapted && withdrawn.has(child.studentId)}
                {...rowProps}
              />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
