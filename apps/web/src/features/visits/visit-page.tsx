import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  CircleDashed,
  Clock,
  HandHeart,
  Printer,
  RotateCcw,
  Trash2,
  UserRoundCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { formatDay } from '@/features/attendance/dates';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { SahayakDraftCard } from '@/features/sahayak/draft-card';
import { withDraft } from '@/features/sahayak/sahayak-api';
import { FeedbackScoreCard } from '@/features/sahayak/score-card';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  chooseRechecks,
  feedbackTips,
  recheckGapIsLarge,
  suggestPractices,
  type ReadingLevel,
} from './coaching';
import { DraftText } from './draft-text';
import { VoiceNoteCard } from './voice-note';
import {
  FOCUS_ITEMS,
  FOCUS_ITEMS_PER_VISIT,
  focusItem,
  MOMENT_TAGS,
  momentTag,
  textIn,
} from './observation-bank';
import { addDays, daysBetween } from './plan';
import { practice as practiceOf, PRACTICES } from './practice-library';
import { finishTime } from './visit-builders';
import {
  CHECK_BACK_RANGE,
  CLOSED_VISIT,
  clusterVisitsKey,
  discardDraft,
  draftOf,
  feedbackIsComplete,
  STALE_VISIT,
  type ClassLabel,
  type Evidence,
  type StoredVisit,
  type Visit,
  type VisitFeedback,
} from './visit-change';
import {
  classPulseChecksQuery,
  crpSignalQuery,
  schoolTeachersQuery,
  useClusterVisits,
  useSaveVisit,
  useVisit,
  type ClassPulseCheck,
} from './visit-api';
import { EnglishLevelLabel, PracticeCard, PracticeDetails, ReadingLevelLabel } from './visit-ui';
import { useFocusText, useSchoolName, visitReasonFor } from './visit-hooks';

type Step = 'observe' | 'children' | 'coach' | 'agree';
const STEPS: Step[] = ['observe', 'children', 'coach', 'agree'];

/** A visit is changed only by its CRP, and only for this many days. */
export const EDIT_DAYS = 14;

function emptyFeedback(visit: Visit, language: 'hi' | 'en'): VisitFeedback {
  return {
    strength: '',
    evidence: [],
    practiceCode: null,
    changeNote: '',
    technique: '',
    demoGiven: false,
    planNote: '',
    checkBackOn: visit.visitedOn ? addDays(visit.visitedOn, 14) : null,
    language,
    agreedAt: null,
  };
}

function minutesSince(startedAt: string | null, now: number): number {
  return startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)) : 0;
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VisitPage({ visitId }: { visitId: string }) {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { visit, stored, waiting, isPending, isError, refetch } = useVisit(visitId);
  const save = useSaveVisit();
  const classId = visit?.classSectionId ?? '';
  const details = useQuery({ ...classDetailsQuery(classId), enabled: classId !== '' });
  const signals = useQuery(crpSignalQuery());
  const schoolName = useSchoolName();
  const [step, setStep] = useState<Step>('observe');
  // Whether the latest change could be neither kept on the phone nor sent; earlier saves that
  // answer later do not count.
  const [notKept, setNotKept] = useState(false);
  const latestSave = useRef(0);
  // A voice note being recorded would be lost if its step were left.
  const [recording, setRecording] = useState(false);
  const today = todayInIndia();
  useDocumentTitle(t('visits.visit.title'));

  if (!visit) {
    return (
      <div className="container-page py-8">
        <QueryState isPending={isPending} isError={isError} onRetry={() => void refetch()}>
          <EmptyState
            icon={CircleDashed}
            title={t('visits.visit.notFound.title')}
            description={t('visits.visit.notFound.body')}
          />
        </QueryState>
      </div>
    );
  }

  // The class's name comes from its details, or from the cluster's list when they are not on the
  // phone; a visit is saved either way.
  const signal = signals.data?.find((entry) => entry.classSectionId === classId);
  const label: ClassLabel | null = details.data
    ? { grade: details.data.grade, section: details.data.section }
    : signal
      ? { grade: signal.grade, section: signal.section }
      : null;
  const title = label ? classLabel(t, label.grade, label.section) : t('visits.visit.title');
  const editable =
    (visit.crpId === null || visit.crpId === access.user_id) &&
    (visit.status === 'planned' ||
      (visit.visitedOn !== null && daysBetween(visit.visitedOn, today) <= EDIT_DAYS));

  // Builds on the working copy kept on the device, which every save updates at once, so that
  // quick taps in a row build on one another; without one, on the server's version as held now.
  const update = (change: (current: Visit) => Visit) => {
    const current =
      draftOf(queryClient, visitId)?.visit ??
      queryClient
        .getQueryData<StoredVisit[]>(clusterVisitsKey())
        ?.find((entry) => entry.id === visitId) ??
      visit;
    const attempt = ++latestSave.current;
    void save(change(current), label).then((kept) => {
      if (attempt === latestSave.current) {
        setNotKept(!kept);
      }
    });
  };

  const start = () =>
    update((current) => ({
      ...current,
      status: 'done',
      visitedOn: today,
      startedAt: new Date().toISOString(),
      plannedOn: null,
    }));

  const stale = waiting.state === 'failed' && waiting.error?.code === STALE_VISIT;
  const closed = waiting.state === 'failed' && waiting.error?.code === CLOSED_VISIT;

  return (
    <div className="container-page space-y-5 py-8">
      <BackLink to="/app/crp/class/$classId" params={{ classId }}>
        {t('visits.visit.backToClass')}
      </BackLink>
      <PageHeader
        title={title}
        description={[
          schoolName(visit.schoolId),
          visit.status === 'done' && visit.visitedOn
            ? t('visits.visit.visitedOn', { date: formatDay(visit.visitedOn, i18n.language) })
            : visit.plannedOn
              ? t('visits.visit.plannedFor', { date: formatDay(visit.plannedOn, i18n.language) })
              : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={<SaveState waiting={waiting} notKept={notKept} />}
      />

      {waiting.state === 'failed' && waiting.error ? (
        <Alert tone="danger" title={t('visits.visit.notSent')}>
          <p>
            {stale
              ? t('visits.visit.stale')
              : closed
                ? t('visits.visit.closed')
                : visitReasonFor(waiting.error, t)}
          </p>
          {stale || closed ? (
            <Button
              className="mt-2"
              variant="secondary"
              onClick={() => {
                const refused = waiting.id;
                void (async () => {
                  // The refused save goes, then the phone's copy, so that the server's shows.
                  if (refused) {
                    await offlineRuntime.discard(refused);
                  }
                  discardDraft(queryClient, visitId);
                  await refetch();
                })();
              }}
            >
              <RotateCcw aria-hidden="true" />
              {t('visits.visit.useServer')}
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {!editable ? <VisitRecord visit={stored ?? visit} /> : null}
      {!editable && (stored ?? visit).crpId === access.user_id ? (
        <FeedbackScoreCard visit={stored ?? visit} />
      ) : null}

      {editable && visit.status === 'planned' ? (
        <Card>
          <CardBody className="space-y-3">
            <p className="text-fg">{t('visits.visit.plannedBody')}</p>
            <Button onClick={start}>
              <Clock aria-hidden="true" />
              {t('visits.visit.start')}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {editable && visit.status === 'done' ? (
        <>
          <nav aria-label={t('visits.visit.stepsLabel')} className="grid grid-cols-4 gap-1">
            {STEPS.map((entry, index) => (
              <button
                key={entry}
                type="button"
                aria-current={step === entry ? 'step' : undefined}
                disabled={recording && step !== entry}
                onClick={() => setStep(entry)}
                className={cn(
                  'min-h-12 rounded-lg border px-2 py-2 text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  step === entry
                    ? 'border-primary bg-primary-soft text-primary-soft-fg'
                    : 'border-border bg-surface text-fg hover:bg-surface-muted',
                )}
              >
                <span className="block text-xs text-fg-muted">{index + 1}</span>
                {t(`visits.step.${entry}`)}
              </button>
            ))}
          </nav>
          {step === 'observe' ? <ObserveStep visit={visit} update={update} /> : null}
          {step === 'children' ? <ChildrenStep visit={visit} update={update} /> : null}
          {step === 'coach' ? (
            <>
              <VoiceNoteCard visit={visit} label={label} onRecordingChange={setRecording} />
              <CoachStep visit={visit} update={update} />
            </>
          ) : null}
          {step === 'agree' ? (
            <AgreeStep
              visit={visit}
              update={update}
              classLabelText={title}
              schoolName={schoolName(visit.schoolId)}
              onFinished={() =>
                void navigate({ to: '/app/crp/class/$classId', params: { classId } })
              }
            />
          ) : null}
          {recording ? (
            <p className="text-sm text-fg-muted">{t('visits.visit.recordingLock')}</p>
          ) : null}
          <div className="flex justify-between gap-2">
            <Button
              variant="secondary"
              disabled={step === 'observe' || recording}
              onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1] ?? 'observe')}
            >
              {t('visits.visit.previous')}
            </Button>
            <Button
              disabled={step === 'agree' || recording}
              onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1] ?? 'agree')}
            >
              {t('visits.visit.next')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Whether the visit is uploaded, announced to screen readers as it changes. */
function SaveState({
  waiting,
  notKept,
}: {
  waiting: ReturnType<typeof useVisit>['waiting'];
  notKept: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span role="status" aria-live="polite">
      {notKept ? (
        <Badge tone="danger">{t('visits.save.notKept')}</Badge>
      ) : !waiting.isLoaded ? null : waiting.state === 'failed' ? (
        <Badge tone="danger">{t('visits.save.failed')}</Badge>
      ) : waiting.state === 'pending' ? (
        <Badge tone="warning">{t('visits.save.waiting')}</Badge>
      ) : (
        <Badge tone="success">{t('visits.save.sent')}</Badge>
      )}
    </span>
  );
}

type Update = (change: (current: Visit) => Visit) => void;

function ObserveStep({ visit, update }: { visit: Visit; update: Update }) {
  const { t, i18n } = useTranslation();
  const teachers = useQuery(schoolTeachersQuery(visit.schoolId));
  const visits = useClusterVisits();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const followed = visits.data?.find((entry) => entry.id === visit.followsVisitId);
  const followedPractice = followed?.feedback?.practiceCode
    ? practiceOf(followed.feedback.practiceCode)
    : undefined;

  const tag = (code: string) =>
    update((current) => {
      if (current.moments.length >= 60) {
        return current;
      }
      const atSeconds = current.startedAt
        ? Math.min(
            43_200,
            Math.max(0, Math.floor((Date.now() - Date.parse(current.startedAt)) / 1000)),
          )
        : 0;
      return {
        ...current,
        moments: [
          ...current.moments,
          { id: crypto.randomUUID(), tagCode: code, atSeconds, note: '' },
        ],
      };
    });

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t('visits.observe.teacher')}>
            <Select
              value={visit.teacherId ?? ''}
              onChange={(event) =>
                update((current) => ({ ...current, teacherId: event.target.value || null }))
              }
            >
              <option value="">{t('visits.observe.teacherNone')}</option>
              {(teachers.data ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('visits.observe.lesson')} hint={t('visits.observe.lessonHint')}>
            <DraftText
              value={visit.lessonNote}
              maxLength={160}
              onCommit={(value) => update((current) => ({ ...current, lessonNote: value }))}
            />
          </Field>
          <p className="flex items-center gap-2 text-sm text-fg-muted sm:col-span-2">
            <Clock className="size-4" aria-hidden="true" />
            {t('visits.observe.elapsed', { count: minutesSince(visit.startedAt, now) })}
          </p>
        </CardBody>
      </Card>

      {followed && followedPractice ? (
        <Card>
          <CardHeader
            title={t('visits.observe.followUpTitle', {
              practice: textIn(followedPractice.title, i18n.language),
            })}
            description={textIn(followedPractice.lookFor, i18n.language)}
          />
          <CardBody>
            <ChoiceGroup
              label={t('visits.observe.followUpQuestion')}
              value={visit.followUpResult}
              onChange={(value) => update((current) => ({ ...current, followUpResult: value }))}
              options={(['practised', 'partly', 'not_yet'] as const).map((value) => ({
                value,
                label: t(`visits.followUp.${value}`),
              }))}
            />
          </CardBody>
        </Card>
      ) : null}

      <FocusItems visit={visit} update={update} />

      <Card>
        <CardHeader
          title={t('visits.observe.momentsTitle')}
          description={t('visits.observe.momentsBody')}
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MOMENT_TAGS.map((entry) => (
              <button
                key={entry.code}
                type="button"
                onClick={() => tag(entry.code)}
                className={cn(
                  'min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  entry.tone === 'strength'
                    ? 'border-success/40 bg-success-soft text-fg'
                    : 'border-warning/40 bg-warning-soft text-fg',
                )}
              >
                {textIn(entry.text, i18n.language)}
              </button>
            ))}
          </div>
          {visit.moments.length > 0 ? (
            <ul
              className="divide-y divide-border rounded-lg border border-border"
              aria-live="polite"
            >
              {[...visit.moments].reverse().map((moment) => {
                const tagEntry = momentTag(moment.tagCode);
                return (
                  <li key={moment.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-12 shrink-0 text-sm text-fg-muted tabular-nums">
                      {clock(moment.atSeconds)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium text-fg">
                        {tagEntry ? textIn(tagEntry.text, i18n.language) : moment.tagCode}
                      </p>
                      <DraftText
                        aria-label={t('visits.observe.momentNote')}
                        placeholder={t('visits.observe.momentNote')}
                        value={moment.note}
                        maxLength={200}
                        className="h-9"
                        onCommit={(value) =>
                          update((current) => ({
                            ...current,
                            moments: current.moments.map((entry) =>
                              entry.id === moment.id ? { ...entry, note: value } : entry,
                            ),
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('visits.observe.removeMoment')}
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          moments: current.moments.filter((entry) => entry.id !== moment.id),
                          feedback: current.feedback
                            ? {
                                ...current.feedback,
                                evidence: current.feedback.evidence.filter(
                                  (entry) => !('moment' in entry) || entry.moment !== moment.id,
                                ),
                              }
                            : null,
                        }))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function FocusItems({ visit, update }: { visit: Visit; update: Update }) {
  const { t, i18n } = useTranslation();
  const focusText = useFocusText();
  const [choosing, setChoosing] = useState(false);
  const chosen = visit.observations.map((item) => item.itemCode);

  const toggle = (code: string) =>
    update((current) => {
      const has = current.observations.some((item) => item.itemCode === code);
      const items = has
        ? current.observations.filter((item) => item.itemCode !== code)
        : current.observations.length >= FOCUS_ITEMS_PER_VISIT
          ? current.observations
          : [...current.observations, { itemCode: code, position: 0, answer: null, note: '' }];
      return {
        ...current,
        observations: items.map((item, index) => ({ ...item, position: index + 1 })),
        feedback: current.feedback
          ? {
              ...current.feedback,
              evidence: current.feedback.evidence.filter(
                (entry) => !('item' in entry) || items.some((item) => item.itemCode === entry.item),
              ),
            }
          : null,
      };
    });

  return (
    <Card>
      <CardHeader
        title={t('visits.observe.focusTitle')}
        description={t('visits.observe.focusBody')}
        actions={
          <Dialog open={choosing} onOpenChange={setChoosing}>
            <DialogTrigger asChild>
              <Button variant="secondary">{t('visits.observe.changeItems')}</Button>
            </DialogTrigger>
            <DialogContent
              title={t('visits.observe.changeItems')}
              description={t('visits.observe.changeItemsBody', { count: FOCUS_ITEMS_PER_VISIT })}
            >
              <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
                {FOCUS_ITEMS.map((item) => {
                  const selected = chosen.includes(item.code);
                  const full = !selected && chosen.length >= FOCUS_ITEMS_PER_VISIT;
                  return (
                    <li key={item.code}>
                      <label
                        className={cn(
                          'flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-border p-3',
                          full && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={selected}
                          disabled={full}
                          onChange={() => toggle(item.code)}
                        />
                        <span className="text-sm text-fg">{textIn(item.text, i18n.language)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </DialogContent>
          </Dialog>
        }
      />
      <CardBody className="space-y-5">
        {visit.observations.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('visits.observe.noItems')}</p>
        ) : null}
        {visit.observations.map((item) => {
          const bank = focusItem(item.itemCode);
          return (
            <div key={item.itemCode} className="space-y-2">
              <ChoiceGroup
                label={`${item.position}. ${focusText(item.itemCode)}`}
                value={item.answer}
                onChange={(answer) =>
                  update((current) => ({
                    ...current,
                    observations: current.observations.map((entry) =>
                      entry.itemCode === item.itemCode ? { ...entry, answer } : entry,
                    ),
                    // An item no longer seen is no longer evidence of a strength.
                    feedback:
                      current.feedback && answer !== 'yes'
                        ? {
                            ...current.feedback,
                            evidence: current.feedback.evidence.filter(
                              (entry) => !('item' in entry) || entry.item !== item.itemCode,
                            ),
                          }
                        : current.feedback,
                  }))
                }
                options={(['yes', 'no', 'not_seen'] as const).map((value) => ({
                  value,
                  label: t(`visits.answer.${value}`),
                }))}
              />
              {bank ? (
                <p className="text-sm text-fg-muted">{textIn(bank.lookFor, i18n.language)}</p>
              ) : null}
              <DraftText
                aria-label={t('visits.observe.itemNote')}
                placeholder={t('visits.observe.itemNote')}
                value={item.note}
                maxLength={300}
                onCommit={(note) =>
                  update((current) => ({
                    ...current,
                    observations: current.observations.map((entry) =>
                      entry.itemCode === item.itemCode ? { ...entry, note } : entry,
                    ),
                  }))
                }
              />
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

const READING_OPTIONS = ['fluent', 'hesitant', 'needs_support'] as const;
const ENGLISH_OPTIONS = ['sentences', 'words', 'no_response'] as const;

/** The checks to choose children from: last month's, else this month's. */
function recheckPool(checks: readonly ClassPulseCheck[], today: string): ClassPulseCheck[] {
  const thisMonth = `${today.slice(0, 7)}-01`;
  const earlier = checks.filter((check) => check.month < thisMonth);
  return earlier.length > 0 ? earlier : checks.filter((check) => check.month === thisMonth);
}

function ChildrenStep({ visit, update }: { visit: Visit; update: Update }) {
  const { t } = useTranslation();
  const checks = useQuery(classPulseChecksQuery(visit.classSectionId));
  const today = todayInIndia();
  const chosen = useMemo(() => {
    const pool = recheckPool(checks.data ?? [], today);
    const recorded = new Set(visit.rechecks.map((entry) => entry.checkId));
    const picked = chooseRechecks(
      pool.map((check) => ({
        checkId: check.checkId,
        studentId: check.studentId,
        teacherReading: check.teacherReading,
        machineReading: check.machine?.reading ?? null,
        reviewed: check.review !== null,
      })),
      visit.id,
    ).map((candidate) => candidate.checkId);
    // Children already heard stay on the list.
    const ids = [...recorded, ...picked.filter((id) => !recorded.has(id))].slice(0, 2);
    return ids
      .map((id) => (checks.data ?? []).find((check) => check.checkId === id))
      .filter((check): check is ClassPulseCheck => check !== undefined);
  }, [checks.data, today, visit.id, visit.rechecks]);

  const record = (
    check: ClassPulseCheck,
    values: Partial<{ readingLevel: ReadingLevel; englishLevel: (typeof ENGLISH_OPTIONS)[number] }>,
  ) =>
    update((current) => {
      const existing = current.rechecks.find((entry) => entry.checkId === check.checkId);
      const next = {
        checkId: check.checkId,
        studentId: check.studentId,
        readingLevel: values.readingLevel ?? existing?.readingLevel ?? check.teacherReading,
        englishLevel: values.englishLevel ?? existing?.englishLevel ?? check.teacherEnglish,
        note: existing?.note ?? '',
      };
      const others = current.rechecks.filter((entry) => entry.checkId !== check.checkId);
      return { ...current, rechecks: [...others, next].slice(0, 2) };
    });

  return (
    <Card>
      <CardHeader title={t('visits.children.title')} description={t('visits.children.body')} />
      <QueryState
        isPending={checks.isPending}
        isError={checks.isError}
        onRetry={() => void checks.refetch()}
      >
        {chosen.length === 0 ? (
          <EmptyState
            icon={UserRoundCheck}
            title={t('visits.children.none.title')}
            description={t('visits.children.none.body')}
          />
        ) : (
          <CardBody className="space-y-6">
            {chosen.map((check) => {
              const heard = visit.rechecks.find((entry) => entry.checkId === check.checkId);
              return (
                <div key={check.checkId} className="space-y-3 rounded-xl border border-border p-4">
                  <div className="space-y-1">
                    <p className="font-semibold text-fg">
                      {check.childName || t('pulse.unnamedChild')}
                    </p>
                    <p className="text-sm text-fg-muted">
                      {t('visits.children.checked')}{' '}
                      <ReadingLevelLabel level={check.teacherReading} />
                      {check.machine ? (
                        <>
                          {' · '}
                          {t('visits.children.engine')}{' '}
                          <ReadingLevelLabel level={check.machine.reading} />
                        </>
                      ) : null}
                    </p>
                  </div>
                  <ChoiceGroup
                    label={t('visits.children.reading')}
                    value={heard?.readingLevel ?? null}
                    onChange={(value) => record(check, { readingLevel: value })}
                    options={READING_OPTIONS.map((value) => ({
                      value,
                      label: <ReadingLevelLabel level={value} />,
                    }))}
                  />
                  <ChoiceGroup
                    label={t('visits.children.english')}
                    value={heard?.englishLevel ?? null}
                    onChange={(value) => record(check, { englishLevel: value })}
                    options={ENGLISH_OPTIONS.map((value) => ({
                      value,
                      label: <EnglishLevelLabel level={value} />,
                    }))}
                  />
                  {heard && recheckGapIsLarge(check.teacherReading, heard.readingLevel) ? (
                    <Alert tone="info">{t('visits.children.gap')}</Alert>
                  ) : null}
                </div>
              );
            })}
          </CardBody>
        )}
      </QueryState>
    </Card>
  );
}

function CoachStep({ visit, update }: { visit: Visit; update: Update }) {
  const { t, i18n } = useTranslation();
  const focusText = useFocusText();
  const uiLanguage = i18n.language === 'en' ? 'en' : 'hi';
  const feedback = visit.feedback ?? emptyFeedback(visit, uiLanguage);
  const suggested = suggestPractices(visit.observations);
  const chosenPractice = feedback.practiceCode ? practiceOf(feedback.practiceCode) : undefined;

  const set = (change: (current: VisitFeedback) => VisitFeedback) =>
    update((current) => ({
      ...current,
      feedback: change(current.feedback ?? emptyFeedback(current, uiLanguage)),
    }));

  const evidenceOptions: { key: string; evidence: Evidence; label: string }[] = [
    ...visit.moments
      .filter((moment) => momentTag(moment.tagCode)?.tone === 'strength')
      .map((moment) => {
        const tag = momentTag(moment.tagCode);
        return {
          key: `moment:${moment.id}`,
          evidence: { moment: moment.id },
          label: `${clock(moment.atSeconds)} ${tag ? textIn(tag.text, i18n.language) : ''}${
            moment.note ? ` – ${moment.note}` : ''
          }`,
        };
      }),
    ...visit.observations
      .filter((item) => item.answer === 'yes')
      .map((item) => ({
        key: `item:${item.itemCode}`,
        evidence: { item: item.itemCode },
        label: focusText(item.itemCode),
      })),
  ];
  const isSelected = (entry: Evidence) =>
    feedback.evidence.some((chosen) =>
      'moment' in entry
        ? 'moment' in chosen && chosen.moment === entry.moment
        : 'item' in chosen && chosen.item === entry.item,
    );

  const tips = feedbackTips(
    {
      strength: feedback.strength,
      evidenceCount: feedback.evidence.length,
      practiceCode: feedback.practiceCode,
      changeNote: feedback.changeNote,
      technique: feedback.technique,
      demoGiven: feedback.demoGiven,
      checkBackOn: feedback.checkBackOn,
    },
    visit.visitedOn ?? todayInIndia(),
  );
  const minDate = visit.visitedOn ? addDays(visit.visitedOn, CHECK_BACK_RANGE.min) : undefined;
  const maxDate = visit.visitedOn ? addDays(visit.visitedOn, CHECK_BACK_RANGE.max) : undefined;

  return (
    <div className="space-y-5">
      {visit.visitedOn ? (
        <SahayakDraftCard
          visit={visit}
          feedback={feedback}
          onUse={(draft) =>
            set((current) =>
              withDraft(current, draft, visit, visit.visitedOn ?? todayInIndia(), CHECK_BACK_RANGE),
            )
          }
          onRestore={(previous) => update((current) => ({ ...current, feedback: previous }))}
        />
      ) : null}
      <Card>
        <CardHeader
          title={t('visits.coach.strengthTitle')}
          description={t('visits.coach.strengthBody')}
        />
        <CardBody className="space-y-4">
          <Field label={t('visits.coach.strength')}>
            <DraftText
              multiline
              value={feedback.strength}
              maxLength={500}
              onCommit={(strength) => set((current) => ({ ...current, strength }))}
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">{t('visits.coach.evidence')}</legend>
            {evidenceOptions.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('visits.coach.noEvidence')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {evidenceOptions.map((option) => {
                  const selected = isSelected(option.evidence);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        set((current) => ({
                          ...current,
                          evidence: selected
                            ? current.evidence.filter((entry) =>
                                'moment' in option.evidence
                                  ? !('moment' in entry) || entry.moment !== option.evidence.moment
                                  : !('item' in entry) || entry.item !== option.evidence.item,
                              )
                            : [...current.evidence, option.evidence].slice(0, 8),
                        }))
                      }
                      className={cn(
                        'min-h-10 rounded-full border px-3 py-1.5 text-left text-sm',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        selected
                          ? 'border-primary bg-primary-soft text-primary-soft-fg'
                          : 'border-border bg-surface text-fg hover:bg-surface-muted',
                      )}
                    >
                      {selected ? (
                        <Check className="me-1 inline size-4" aria-hidden="true" />
                      ) : null}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('visits.coach.stepTitle')} description={t('visits.coach.stepBody')} />
        <CardBody className="space-y-4">
          {suggested.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-fg">{t('visits.coach.suggested')}</p>
              <div className="flex flex-wrap gap-2">
                {suggested.map((entry) => (
                  <Button
                    key={entry.code}
                    variant={feedback.practiceCode === entry.code ? 'primary' : 'secondary'}
                    aria-pressed={feedback.practiceCode === entry.code}
                    onClick={() => set((current) => ({ ...current, practiceCode: entry.code }))}
                  >
                    {textIn(entry.title, i18n.language)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <Field label={t('visits.coach.practice')}>
            <Select
              value={feedback.practiceCode ?? ''}
              onChange={(event) =>
                set((current) => ({ ...current, practiceCode: event.target.value || null }))
              }
            >
              <option value="">{t('visits.coach.choosePractice')}</option>
              {PRACTICES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {textIn(entry.title, i18n.language)}
                </option>
              ))}
            </Select>
          </Field>
          {chosenPractice ? <PracticeDetails practice={chosenPractice} /> : null}
          <Field label={t('visits.coach.change')} hint={t('visits.coach.changeHint')}>
            <DraftText
              multiline
              value={feedback.changeNote}
              maxLength={500}
              onCommit={(changeNote) => set((current) => ({ ...current, changeNote }))}
            />
          </Field>
          <Field label={t('visits.coach.technique')} hint={t('visits.coach.techniqueHint')}>
            <DraftText
              multiline
              value={feedback.technique}
              maxLength={1000}
              onCommit={(technique) => set((current) => ({ ...current, technique }))}
            />
          </Field>
          <label className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 py-2">
            <input
              type="checkbox"
              className="size-5"
              checked={feedback.demoGiven}
              onChange={(event) =>
                set((current) => ({ ...current, demoGiven: event.target.checked }))
              }
            />
            <span className="text-sm text-fg">{t('visits.coach.demoGiven')}</span>
          </label>
          <Field label={t('visits.coach.plan')} hint={t('visits.coach.planHint')}>
            <DraftText
              multiline
              value={feedback.planNote}
              maxLength={1000}
              onCommit={(planNote) => set((current) => ({ ...current, planNote }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('visits.coach.checkBack')}
              hint={t('visits.coach.checkBackHint', {
                min: CHECK_BACK_RANGE.min,
                max: CHECK_BACK_RANGE.max / 7,
              })}
            >
              <Input
                type="date"
                value={feedback.checkBackOn ?? ''}
                min={minDate}
                max={maxDate}
                onChange={(event) =>
                  set((current) => ({ ...current, checkBackOn: event.target.value || null }))
                }
              />
            </Field>
            <Field label={t('visits.coach.language')}>
              <Select
                value={feedback.language}
                onChange={(event) =>
                  set((current) => ({
                    ...current,
                    language: event.target.value === 'en' ? 'en' : 'hi',
                  }))
                }
              >
                <option value="hi">हिन्दी</option>
                <option value="en">English</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('visits.coach.tipsTitle')} description={t('visits.coach.tipsBody')} />
        <CardBody>
          <ul className="space-y-2">
            {tips.map((tip) => (
              <li key={tip.key} className="flex items-start gap-2 text-sm">
                {tip.met ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashed
                    className="mt-0.5 size-4 shrink-0 text-fg-muted"
                    aria-hidden="true"
                  />
                )}
                <span className={tip.met ? 'text-fg' : 'text-fg-muted'}>
                  <span className="sr-only">
                    {tip.met ? t('visits.coach.tipMet') : t('visits.coach.tipOpen')}
                  </span>
                  {t(`visits.tip.${tip.key}`)}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function AgreeStep({
  visit,
  update,
  classLabelText,
  schoolName,
  onFinished,
}: {
  visit: Visit;
  update: Update;
  classLabelText: string;
  schoolName: string;
  onFinished: () => void;
}) {
  const { t, i18n } = useTranslation();
  const teachers = useQuery(schoolTeachersQuery(visit.schoolId));
  const complete = feedbackIsComplete(visit);
  const chosenPractice = visit.feedback?.practiceCode
    ? practiceOf(visit.feedback.practiceCode)
    : undefined;
  const teacherName =
    teachers.data?.find((entry) => entry.id === visit.teacherId)?.fullName ?? null;
  const unanswered = visit.observations.filter((item) => item.answer === null).length;

  return (
    <div className="space-y-5">
      {!complete ? (
        <Alert tone="warning" title={t('visits.agree.incompleteTitle')}>
          {t('visits.agree.incompleteBody')}
        </Alert>
      ) : null}
      {unanswered > 0 ? (
        <Alert tone="info">{t('visits.agree.unanswered', { count: unanswered })}</Alert>
      ) : null}
      {complete && chosenPractice ? (
        <>
          <PracticeCard
            visit={visit}
            practice={chosenPractice}
            classLabel={classLabelText}
            schoolName={schoolName}
            teacherName={teacherName}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant={visit.feedback?.agreedAt ? 'secondary' : 'primary'}
              onClick={() =>
                update((current) =>
                  current.feedback
                    ? {
                        ...current,
                        feedback: {
                          ...current.feedback,
                          agreedAt: current.feedback.agreedAt ? null : new Date().toISOString(),
                        },
                      }
                    : current,
                )
              }
            >
              <HandHeart aria-hidden="true" />
              {visit.feedback?.agreedAt
                ? t('visits.agree.agreedAt', {
                    time: new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(visit.feedback.agreedAt)),
                  })
                : t('visits.agree.agree')}
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              {t('visits.agree.print')}
            </Button>
          </div>
          <FeedbackScoreCard visit={visit} />
        </>
      ) : null}
      <Card>
        <CardBody className="space-y-3">
          <p className="text-sm text-fg-muted">{t('visits.agree.finishBody')}</p>
          <Button
            onClick={() => {
              update((current) => ({
                ...current,
                finishedAt: current.finishedAt ?? finishTime(current.startedAt),
              }));
              onFinished();
            }}
          >
            <Check aria-hidden="true" />
            {visit.finishedAt ? t('visits.agree.done') : t('visits.agree.finish')}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

/** A visit as recorded, for reading only. */
export function VisitRecord({ visit }: { visit: Visit }) {
  const { t, i18n } = useTranslation();
  const focusText = useFocusText();
  const chosenPractice = visit.feedback?.practiceCode
    ? practiceOf(visit.feedback.practiceCode)
    : undefined;
  return (
    <Card>
      <CardBody className="space-y-4 text-sm">
        {visit.lessonNote ? (
          <p>
            <span className="font-medium text-fg">{t('visits.observe.lesson')}:</span>{' '}
            {visit.lessonNote}
          </p>
        ) : null}
        {visit.followUpResult ? (
          <p>
            <span className="font-medium text-fg">{t('visits.record.followUp')}</span>{' '}
            {t(`visits.followUp.${visit.followUpResult}`)}
          </p>
        ) : null}
        {visit.observations.length > 0 ? (
          <ul className="space-y-1">
            {visit.observations.map((item) => (
              <li key={item.itemCode} className="flex flex-wrap items-baseline gap-2">
                <Badge
                  tone={
                    item.answer === 'yes' ? 'success' : item.answer === 'no' ? 'warning' : 'neutral'
                  }
                >
                  {item.answer ? t(`visits.answer.${item.answer}`) : t('visits.record.notAnswered')}
                </Badge>
                <span className="text-fg">{focusText(item.itemCode)}</span>
                {item.note ? <span className="text-fg-muted">– {item.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {visit.moments.length > 0 ? (
          <p className="text-fg-muted">
            {visit.moments
              .map((moment) => {
                const tag = momentTag(moment.tagCode);
                return `${clock(moment.atSeconds)} ${tag ? textIn(tag.text, i18n.language) : moment.tagCode}`;
              })
              .join(' · ')}
          </p>
        ) : null}
        {visit.feedback ? (
          <div className="space-y-1">
            <p>
              <span className="font-medium text-fg">{t('visits.card.strength')}:</span>{' '}
              {visit.feedback.strength}
            </p>
            {chosenPractice ? (
              <p>
                <span className="font-medium text-fg">{t('visits.card.step')}:</span>{' '}
                {textIn(chosenPractice.title, i18n.language)}
                {visit.feedback.checkBackOn
                  ? ` · ${t('visits.card.checkBack', {
                      date: formatDay(visit.feedback.checkBackOn, i18n.language),
                    })}`
                  : null}
              </p>
            ) : null}
            {visit.feedback.agreedAt ? (
              <Badge tone="success">{t('visits.record.agreed')}</Badge>
            ) : (
              <Badge>{t('visits.record.notAgreed')}</Badge>
            )}
          </div>
        ) : (
          <p className="text-fg-muted">{t('visits.record.noFeedback')}</p>
        )}
      </CardBody>
    </Card>
  );
}
