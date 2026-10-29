import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { classDetailsQuery, classRosterQuery } from '@/features/attendance/attendance-api';
import { formatDay, addDays } from '@/features/attendance/dates';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { focusItem, momentTag, textIn } from '@/features/visits/observation-bank';
import { practice } from '@/features/visits/practice-library';
import {
  crpSignalQuery,
  schoolTeachersQuery,
  useClusterVisits,
  visitNoteQuery,
} from '@/features/visits/visit-api';
import { CHECK_BACK_RANGE, type Visit, type VisitFeedback } from '@/features/visits/visit-change';
import {
  checkBackDaysOf,
  draftFeedback,
  draftRequest,
  namesToHide,
  sahayakError,
  type FeedbackDraft,
} from './sahayak-api';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; draft: FeedbackDraft }
  | { kind: 'used'; previous: VisitFeedback | null }
  | { kind: 'error'; message: string };

/**
 * Asks Sahayak for a draft of the feedback, from what the CRP recorded in this visit, the class's
 * Pulse and the voice note's transcript. The draft is shown beside the form; the CRP takes it in
 * with one tap, then edits it like their own writing. Nothing is sent to the teacher.
 */
export function SahayakDraftCard({
  visit,
  feedback,
  onUse,
  onRestore,
}: {
  visit: Visit;
  /** The feedback as the form shows it (an empty one before anything was written). */
  feedback: VisitFeedback;
  onUse: (draft: FeedbackDraft) => void;
  /** Brings back the feedback as it was saved before the draft, none if there was none. */
  onRestore: (previous: VisitFeedback | null) => void;
}) {
  const language = feedback.language;
  const { t, i18n } = useTranslation();
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const details = useQuery(classDetailsQuery(visit.classSectionId));
  const roster = useQuery(classRosterQuery(visit.classSectionId));
  const teachers = useQuery(schoolTeachersQuery(visit.schoolId));
  const signals = useQuery(crpSignalQuery());
  const note = useQuery(visitNoteQuery(visit.id));
  const clusterVisits = useClusterVisits();
  const visits = clusterVisits.data ?? [];

  const observed = visit.observations.length > 0 || visit.moments.length > 0;
  // Names are taken out on the phone, so the class list and the teachers must be at hand first.
  const namesReady = roster.isSuccess && teachers.isSuccess;
  const namesFailed = roster.isError || teachers.isError;
  const transcript = note.data?.transcript ?? null;

  const ask = async () => {
    setState({ kind: 'loading' });
    const earlier = visit.followsVisitId
      ? visits.find((entry) => entry.id === visit.followsVisitId)
      : undefined;
    const teacher = teachers.data?.find((entry) => entry.id === visit.teacherId)?.fullName ?? null;
    const signal = signals.data?.find((entry) => entry.classSectionId === visit.classSectionId);
    try {
      const draft = await draftFeedback(
        draftRequest({
          visit,
          language,
          grade: details.data?.grade ?? null,
          signal: signal ?? null,
          earlier: earlier
            ? { practiceCode: earlier.feedback?.practiceCode ?? null, result: visit.followUpResult }
            : null,
          transcript,
          names: namesToHide(
            (roster.data ?? []).map((entry) => entry.fullName),
            teacher,
          ),
        }),
      );
      setState({ kind: 'ready', draft });
    } catch (error) {
      setState({ kind: 'error', message: sahayakError(error, t) });
    }
  };

  const evidenceLabel = (entry: FeedbackDraft['evidence'][number]) => {
    if ('moment' in entry) {
      const moment = visit.moments.find((candidate) => candidate.id === entry.moment);
      const tag = moment ? momentTag(moment.tagCode) : undefined;
      return tag ? textIn(tag.text, i18n.language) : t('sahayak.draft.moment');
    }
    const item = focusItem(entry.item);
    return item ? textIn(item.text, i18n.language) : entry.item;
  };

  return (
    <Card aria-labelledby="sahayak-draft" className="border-primary/40">
      <CardHeader
        titleId="sahayak-draft"
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            {t('sahayak.draft.title')}
          </span>
        }
        description={t('sahayak.draft.description')}
        actions={
          state.kind === 'ready' ? null : (
            <Button
              variant="soft"
              disabled={!isOnline || !observed || !namesReady || state.kind === 'loading'}
              onClick={() => void ask()}
            >
              {state.kind === 'loading' ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {state.kind === 'loading' ? t('sahayak.draft.working') : t('sahayak.draft.ask')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {!observed ? (
          <p className="text-sm text-fg-muted">{t('sahayak.draft.observeFirst')}</p>
        ) : null}
        {!isOnline ? <p className="text-sm text-fg-muted">{t('sahayak.offline')}</p> : null}
        {isOnline && observed && !namesReady ? (
          <p className="text-sm text-fg-muted">
            {namesFailed ? t('sahayak.draft.namesFailed') : t('sahayak.draft.namesLoading')}
          </p>
        ) : null}
        {state.kind === 'used' ? (
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <p className="text-sm text-fg">{t('sahayak.draft.used')}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onRestore(state.previous);
                setState({ kind: 'idle' });
              }}
            >
              {t('sahayak.draft.undo')}
            </Button>
          </div>
        ) : null}
        {observed && isOnline && state.kind === 'idle' ? (
          <p className="text-sm text-fg-muted">
            {transcript ? t('sahayak.draft.withNote') : t('sahayak.draft.withoutNote')}
          </p>
        ) : null}
        {state.kind === 'error' ? <Alert tone="danger">{state.message}</Alert> : null}
        {state.kind === 'ready' ? (
          <div className="space-y-4" aria-live="polite">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium text-fg">{t('visits.coach.strength')}</dt>
                <dd className="whitespace-pre-wrap text-fg">{state.draft.strength}</dd>
                {state.draft.evidence.length > 0 ? (
                  <dd className="mt-1 text-fg-muted">
                    {t('sahayak.draft.evidence', {
                      list: state.draft.evidence.map(evidenceLabel).join(', '),
                    })}
                  </dd>
                ) : (
                  <dd className="mt-1 text-warning">{t('sahayak.draft.noEvidence')}</dd>
                )}
              </div>
              <div>
                <dt className="font-medium text-fg">{t('visits.coach.practice')}</dt>
                <dd className="text-fg">
                  {(() => {
                    const chosen = practice(state.draft.practiceCode);
                    return chosen ? textIn(chosen.title, i18n.language) : state.draft.practiceCode;
                  })()}
                </dd>
              </div>
              {(
                [
                  ['visits.coach.change', state.draft.changeNote],
                  ['visits.coach.technique', state.draft.technique],
                  ['visits.coach.plan', state.draft.planNote],
                ] as const
              ).map(([label, text]) =>
                text ? (
                  <div key={label}>
                    <dt className="font-medium text-fg">{t(label)}</dt>
                    <dd className="whitespace-pre-wrap text-fg">{text}</dd>
                  </div>
                ) : null,
              )}
              {visit.visitedOn ? (
                <div>
                  <dt className="font-medium text-fg">{t('visits.coach.checkBack')}</dt>
                  <dd className="text-fg">
                    {formatDay(
                      addDays(visit.visitedOn, checkBackDaysOf(state.draft, CHECK_BACK_RANGE)),
                      i18n.language,
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="text-sm text-fg-muted">{t('sahayak.draft.yourCall')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  onUse(state.draft);
                  setState({ kind: 'used', previous: visit.feedback });
                }}
              >
                {t('sahayak.draft.use')}
              </Button>
              <Button variant="ghost" onClick={() => setState({ kind: 'idle' })}>
                <X aria-hidden="true" />
                {t('sahayak.draft.discard')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
