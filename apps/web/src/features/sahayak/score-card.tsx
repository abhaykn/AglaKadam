import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { visitDedupeKey, type Visit } from '@/features/visits/visit-change';
import { cn } from '@/lib/cn';
import {
  feedbackScoreKey,
  feedbackScoreQuery,
  SCORE_PARTS,
  sahayakError,
  fingerprintOf,
  scoreFeedback,
  scoreIsCurrent,
} from './sahayak-api';

/**
 * The private score of the feedback the CRP agreed with the teacher, against the rubric of good
 * coaching feedback, with one tip. Only the CRP sees it; it is a mirror for their own practice,
 * not a mark given by anyone.
 */
export function FeedbackScoreCard({ visit }: { visit: Visit }) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const agreedAt = visit.feedback?.agreedAt ?? null;
  const language = visit.feedback?.language ?? 'hi';
  const score = useQuery(feedbackScoreQuery(visit.id));
  const waiting = useWaitingChange(visitDedupeKey(visit.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedback = visit.feedback;
  const [computed, setComputed] = useState<{ of: typeof feedback; value: string } | null>(null);
  // The score shown is of the feedback shown, also when it was edited after scoring.
  useEffect(() => {
    let active = true;
    if (feedback) {
      void fingerprintOf(feedback).then((value) => {
        if (active) {
          setComputed({ of: feedback, value });
        }
      });
    }
    return () => {
      active = false;
    };
  }, [feedback]);
  const fingerprint = computed?.of === feedback ? computed.value : null;

  if (!agreedAt) {
    return null;
  }
  const current = score.data && scoreIsCurrent(score.data, fingerprint) ? score.data : null;
  // The server scores the feedback it holds; feedback still waiting on the phone is not there yet.
  const uploaded = waiting.isLoaded && waiting.state === null;

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await scoreFeedback(visit.id, language);
      queryClient.setQueryData(feedbackScoreKey(visit.id), result);
    } catch (failure) {
      setError(sahayakError(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby={`score-${visit.id}`}>
      <CardHeader
        titleId={`score-${visit.id}`}
        title={
          <span className="inline-flex items-center gap-2">
            <Gauge className="size-5 text-primary" aria-hidden="true" />
            {t('sahayak.score.title')}
          </span>
        }
        description={t('sahayak.score.description')}
        actions={
          current ? null : (
            <Button
              variant="soft"
              disabled={!isOnline || !uploaded || busy}
              onClick={() => void ask()}
            >
              {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {t('sahayak.score.ask')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {!current && !uploaded ? (
          <p className="text-sm text-fg-muted">{t('sahayak.score.uploadFirst')}</p>
        ) : null}
        {!current && uploaded && !isOnline ? (
          <p className="text-sm text-fg-muted">{t('sahayak.offline')}</p>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {current ? (
          <div className="space-y-4" aria-live="polite">
            <p className="text-2xl font-bold text-fg tabular-nums">
              {t('sahayak.score.total', { total: current.total, max: SCORE_PARTS.length * 2 })}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SCORE_PARTS.map((part) => (
                <li key={part} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-fg">{t(`sahayak.score.parts.${part}`)}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                      current[part] === 2
                        ? 'bg-success-soft text-success'
                        : current[part] === 1
                          ? 'bg-warning-soft text-warning'
                          : 'bg-danger-soft text-danger',
                    )}
                  >
                    {t('sahayak.score.part', { value: current[part] })}
                  </span>
                </li>
              ))}
            </ul>
            <Alert tone="info" title={t('sahayak.score.tip')}>
              <span lang={language}>{current.tip}</span>
            </Alert>
            <p className="text-sm text-fg-muted">{t('sahayak.score.private')}</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
