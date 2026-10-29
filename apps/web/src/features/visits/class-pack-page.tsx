import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AudioLines,
  CalendarPlus,
  ClipboardList,
  History,
  MessageCircleQuestion,
  Play,
  Scale,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { dayInIndia, formatDay } from '@/features/attendance/dates';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { calibration, suggestFocusItems, suggestPractices, type LevelPair } from './coaching';
import { MarksCheckCard } from '@/features/exams/marks-check-card';
import { newVisit, stepToFollowUp } from './visit-builders';
import type { Visit } from './visit-change';
import { ListenPlayer } from './listen-player';
import { textIn } from './observation-bank';
import { workingDaysFrom, type ClassSignal } from './plan';
import { practice as practiceOf } from './practice-library';
import {
  classPulseChecksQuery,
  crpSignalQuery,
  needsListening,
  openRequestQuery,
  useClusterVisits,
  useSaveReview,
  useSaveVisit,
  type ClassPulseCheck,
} from './visit-api';
import { EnglishLevelLabel, PracticeDetails, ReadingLevelLabel } from './visit-ui';
import { useFocusText, useSchoolName } from './visit-hooks';

const READING_OPTIONS = ['fluent', 'hesitant', 'needs_support'] as const;
const ENGLISH_OPTIONS = ['sentences', 'words', 'no_response'] as const;

export function ClassPackPage({ classSectionId }: { classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const navigate = useNavigate();
  const today = todayInIndia();
  const details = useQuery(classDetailsQuery(classSectionId));
  const signals = useQuery(crpSignalQuery());
  const visits = useClusterVisits();
  const checks = useQuery(classPulseChecksQuery(classSectionId));
  const request = useQuery(openRequestQuery(classSectionId));
  const save = useSaveVisit();
  const schoolName = useSchoolName();
  const focusText = useFocusText();
  const [planning, setPlanning] = useState(false);
  // A second tap while a visit is being kept must not make a second visit.
  const [busy, setBusy] = useState(false);

  const signal = signals.data?.find((entry) => entry.classSectionId === classSectionId);
  const title = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('visits.pack.title');
  useDocumentTitle(title);

  const ofClass = (visits.data ?? []).filter((visit) => visit.classSectionId === classSectionId);
  const followUp = stepToFollowUp(visits.data ?? [], classSectionId);
  const followPractice = followUp?.feedback?.practiceCode
    ? practiceOf(followUp.feedback.practiceCode)
    : undefined;
  const todays = ofClass.find(
    (visit) =>
      visit.status === 'done' && visit.visitedOn === today && visit.crpId === access.user_id,
  );
  const planned = ofClass
    .filter((visit) => visit.status === 'planned')
    .sort((a, b) => (a.plannedOn ?? '').localeCompare(b.plannedOn ?? ''));
  const focus = suggestFocusItems(signal ?? null, followUp?.feedback?.practiceCode ?? null);
  const practices = suggestPractices(focus.map((itemCode) => ({ itemCode, answer: null })));
  const history = ofClass
    .filter((visit) => visit.status === 'done')
    .sort((a, b) => (b.visitedOn ?? '').localeCompare(a.visitedOn ?? ''));
  const toListen = (checks.data ?? []).filter(needsListening);

  // How the teacher's reading levels compare with the CRP's own, from reviews and re-checks.
  const pairs: LevelPair[] = [
    ...(checks.data ?? []).flatMap((check) =>
      check.review ? [{ teacher: check.teacherReading, crp: check.review.reading }] : [],
    ),
    ...history.flatMap((visit) =>
      visit.rechecks.flatMap((recheck) => {
        const checked = checks.data?.find((check) => check.checkId === recheck.checkId);
        return checked ? [{ teacher: checked.teacherReading, crp: recheck.readingLevel }] : [];
      }),
    ),
  ];
  const agreement = calibration(pairs);

  // The CRP's own visit planned for today (or earlier and not made) is the one started.
  const plannedNow = planned.find(
    (visit) =>
      visit.crpId === access.user_id && visit.plannedOn !== null && visit.plannedOn <= today,
  );
  const schoolId = details.data?.school.id ?? signal?.schoolId ?? null;
  const label = details.data
    ? { grade: details.data.grade, section: details.data.section }
    : signal
      ? { grade: signal.grade, section: signal.section }
      : null;

  const create = async (plannedOn: string | null) => {
    if (busy || schoolId === null) {
      return;
    }
    setBusy(true);
    try {
      const visit: Visit =
        plannedOn === null && plannedNow
          ? {
              ...plannedNow,
              status: 'done',
              visitedOn: today,
              startedAt: new Date().toISOString(),
              plannedOn: null,
            }
          : newVisit({
              classSectionId,
              schoolId,
              crpId: access.user_id,
              signal,
              followsVisit: followUp,
              requestId: request.data?.id ?? null,
              plannedOn,
              today,
            });
      if (!(await save(visit, label))) {
        return;
      }
      if (plannedOn === null) {
        void navigate({ to: '/app/crp/visit/$visitId', params: { visitId: visit.id } });
      } else {
        setPlanning(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page space-y-5 py-8">
      <BackLink to="/app/crp/plan">{t('visits.pack.backToPlan')}</BackLink>
      <PageHeader
        title={title}
        description={details.data ? schoolName(details.data.school.id) : undefined}
        actions={
          <>
            {todays ? (
              <Button asChild>
                <Link to="/app/crp/visit/$visitId" params={{ visitId: todays.id }}>
                  <Play aria-hidden="true" />
                  {t('visits.pack.continue')}
                </Link>
              </Button>
            ) : (
              <Button disabled={schoolId === null || busy} onClick={() => void create(null)}>
                <Play aria-hidden="true" />
                {t('visits.pack.start')}
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link to="/app/progress/$classId" params={{ classId: classSectionId }}>
                <TrendingUp aria-hidden="true" />
                {t('progress.open')}
              </Link>
            </Button>
            <Dialog open={planning} onOpenChange={setPlanning}>
              <DialogTrigger asChild>
                <Button variant="secondary" disabled={schoolId === null}>
                  <CalendarPlus aria-hidden="true" />
                  {t('visits.pack.plan')}
                </Button>
              </DialogTrigger>
              <DialogContent title={t('visits.pack.planTitle')} description={title}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {workingDaysFrom(today, 9).map((day) => (
                    <Button
                      key={day}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void create(day)}
                    >
                      {formatDay(day, i18n.language)}
                    </Button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {request.data ? (
        <Alert tone="info" title={t('visits.pack.requestTitle')}>
          {t('visits.pack.requestBody', {
            topic: t(`visits.topic.${request.data.topic}`),
            date: formatDay(dayInIndia(request.data.createdAt), i18n.language),
          })}
          {request.data.note ? <p className="mt-1">“{request.data.note}”</p> : null}
        </Alert>
      ) : null}

      {planned.length > 0 ? (
        <Card>
          <CardHeader title={t('visits.pack.plannedTitle')} />
          <ul className="divide-y divide-border">
            {planned.map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="text-fg">
                  {visit.plannedOn ? formatDay(visit.plannedOn, i18n.language) : ''}
                </span>
                <Button asChild variant="secondary">
                  <Link to="/app/crp/visit/$visitId" params={{ visitId: visit.id }}>
                    {t('visits.pack.openPlanned')}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('visits.pack.pulseTitle')}
            description={
              signal?.pulseMonth
                ? t('visits.pack.pulseMonth', {
                    month: new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(`${signal.pulseMonth}T00:00:00Z`)),
                  })
                : t('visits.pack.noPulse')
            }
          />
          {signal && signal.pulseChecked > 0 ? (
            <CardBody className="space-y-3">
              <LevelBar signal={signal} />
              <p className="text-sm text-fg-muted">
                {t('visits.pack.englishNone', {
                  count: signal.englishNoResponse,
                  checked: signal.pulseChecked,
                })}
              </p>
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader title={t('visits.pack.stepTitle')} />
          <CardBody className="space-y-2 text-sm">
            {followUp && followPractice ? (
              <>
                <p className="font-medium text-fg">{textIn(followPractice.title, i18n.language)}</p>
                <p className="text-fg-muted">
                  {followUp.visitedOn
                    ? t('visits.pack.agreedOn', {
                        date: formatDay(followUp.visitedOn, i18n.language),
                      })
                    : null}
                  {followUp.feedback?.checkBackOn
                    ? ` · ${t('visits.card.checkBack', {
                        date: formatDay(followUp.feedback.checkBackOn, i18n.language),
                      })}`
                    : null}
                </p>
                <p className="text-fg">{textIn(followPractice.lookFor, i18n.language)}</p>
              </>
            ) : (
              <p className="text-fg-muted">{t('visits.pack.noStep')}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <ClipboardList className="size-5 text-primary" aria-hidden="true" />
              {t('visits.pack.focusTitle')}
            </span>
          }
          description={t('visits.pack.focusBody')}
        />
        <CardBody>
          <ol className="list-decimal space-y-1 ps-5 text-sm text-fg">
            {focus.map((code) => (
              <li key={code}>{focusText(code)}</li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              {t('visits.pack.practicesTitle')}
            </span>
          }
          description={t('visits.pack.practicesBody')}
        />
        <CardBody className="space-y-3">
          {practices.map((entry) => (
            <details key={entry.code} className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer font-medium text-fg">
                {textIn(entry.title, i18n.language)}
              </summary>
              <PracticeDetails practice={entry} className="mt-3" />
            </details>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <AudioLines className="size-5 text-primary" aria-hidden="true" />
              {t('visits.listen.title')}
            </span>
          }
          description={t('visits.listen.body')}
        />
        <QueryState
          isPending={checks.isPending}
          isError={checks.isError}
          onRetry={() => void checks.refetch()}
        >
          {toListen.length === 0 ? (
            <CardBody>
              <p className="text-sm text-fg-muted">{t('visits.listen.none')}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {toListen.map((check) => (
                <ReviewRow key={check.checkId} check={check} classSectionId={classSectionId} />
              ))}
            </ul>
          )}
        </QueryState>
      </Card>

      {details.data && details.data.grade >= 1 && details.data.grade <= 3 ? (
        <MarksCheckCard classSectionId={classSectionId} />
      ) : null}

      {agreement.prompt ? (
        <Alert tone="info" title={t('visits.calibration.title')}>
          <span className="inline-flex items-start gap-2">
            <Scale className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('visits.calibration.body', {
              agreed: agreement.agreed,
              compared: agreement.compared,
            })}
          </span>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <History className="size-5 text-primary" aria-hidden="true" />
              {t('visits.pack.historyTitle')}
            </span>
          }
        />
        <QueryState
          isPending={visits.isPending}
          isError={visits.isError}
          onRetry={() => void visits.refetch()}
        >
          {history.length === 0 ? (
            <EmptyState
              icon={MessageCircleQuestion}
              title={t('visits.pack.noHistory.title')}
              description={t('visits.pack.noHistory.body')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {history.map((visit) => {
                const step = visit.feedback?.practiceCode
                  ? practiceOf(visit.feedback.practiceCode)
                  : undefined;
                return (
                  <li
                    key={visit.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-fg">
                        {visit.visitedOn ? formatDay(visit.visitedOn, i18n.language) : ''}
                      </p>
                      <p className="text-sm text-fg-muted">
                        {step ? textIn(step.title, i18n.language) : t('visits.record.noFeedback')}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {visit.feedback?.agreedAt ? (
                          <Badge tone="success">{t('visits.record.agreed')}</Badge>
                        ) : null}
                        {visit.followUpResult ? (
                          <Badge tone="brand">{t(`visits.followUp.${visit.followUpResult}`)}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <Button asChild variant="secondary">
                      <Link to="/app/crp/visit/$visitId" params={{ visitId: visit.id }}>
                        {t('visits.pack.openVisit')}
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

/** The share of children at each reading level, as one bar with its legend. */
export function LevelBar({ signal }: { signal: ClassSignal }) {
  const { t } = useTranslation();
  const total = Math.max(1, signal.pulseChecked);
  const parts = [
    { key: 'needs_support', value: signal.needsSupport, className: 'bg-danger' },
    { key: 'hesitant', value: signal.hesitant, className: 'bg-warning' },
    { key: 'fluent', value: signal.fluent, className: 'bg-success' },
  ];
  return (
    <div className="space-y-2">
      <div
        className="flex h-3 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={t('visits.pack.levelsLabel', {
          needs: signal.needsSupport,
          hesitant: signal.hesitant,
          fluent: signal.fluent,
          checked: signal.pulseChecked,
        })}
      >
        {parts.map((part) => (
          <div
            key={part.key}
            className={part.className}
            style={{ width: `${(part.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
        {parts.map((part) => (
          <li key={part.key} className="inline-flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${part.className}`} aria-hidden="true" />
            <ReadingLevelLabel level={part.key} />: {part.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewRow({ check, classSectionId }: { check: ClassPulseCheck; classSectionId: string }) {
  const { t } = useTranslation();
  const saveReview = useSaveReview();
  const [reading, setReading] = useState<(typeof READING_OPTIONS)[number] | null>(null);
  const [english, setEnglish] = useState<(typeof ENGLISH_OPTIONS)[number] | null>(null);
  const name = check.childName || t('pulse.unnamedChild');
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="space-y-1">
        <p className="font-medium text-fg">{name}</p>
        <p className="text-sm text-fg-muted">
          {t('visits.listen.teacher')} <ReadingLevelLabel level={check.teacherReading} />,{' '}
          <EnglishLevelLabel level={check.teacherEnglish} />
          {check.machine ? (
            <>
              {' · '}
              {t('visits.listen.engine')} <ReadingLevelLabel level={check.machine.reading} />,{' '}
              <EnglishLevelLabel level={check.machine.english} />
              {check.machine.unsure ? ` (${t('visits.listen.unsure')})` : null}
            </>
          ) : null}
        </p>
      </div>
      {check.audioPath ? (
        <ListenPlayer bucket="pulse-audio" path={check.audioPath} label={name} />
      ) : null}
      <ChoiceGroup
        label={t('visits.listen.yourReading')}
        value={reading}
        onChange={setReading}
        options={READING_OPTIONS.map((value) => ({
          value,
          label: <ReadingLevelLabel level={value} />,
        }))}
      />
      <ChoiceGroup
        label={t('visits.listen.yourEnglish')}
        value={english}
        onChange={setEnglish}
        options={ENGLISH_OPTIONS.map((value) => ({
          value,
          label: <EnglishLevelLabel level={value} />,
        }))}
      />
      <Button
        disabled={reading === null || english === null}
        onClick={() => {
          if (reading && english) {
            void saveReview({
              checkId: check.checkId,
              classSectionId,
              readingLevel: reading,
              englishLevel: english,
              note: '',
              childName: name.slice(0, 120),
            });
          }
        }}
      >
        {t('visits.listen.save')}
      </Button>
    </li>
  );
}
