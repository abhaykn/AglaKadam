import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Gauge, MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ValueTrend } from '@/components/charts/trend-charts';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { checksMet, debriefsQuery } from '@/features/sahayak/sahayak-api';
import { useClusterVisits } from '@/features/visits/visit-api';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { myScoresQuery } from './progress-api';
import { coachingByMonth, lastMonths, monthLabels, percent } from './progress';

/**
 * The CRP's own growth as a coach, month by month: how often the agreed step was in use at the
 * next visit, how good the feedback was, how soon it was given, and the rehearsals. Only the CRP
 * sees this page; offices see totals over many CRPs' classes, never one CRP.
 */
export function MyCoachingPage() {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const visits = useClusterVisits();
  const months = lastMonths(todayInIndia(), 6);
  const scores = useQuery(myScoresQuery(months[0] ?? todayInIndia()));
  const debriefs = useQuery(debriefsQuery());
  useDocumentTitle(t('progress.mine.title'));
  const language = i18n.language;
  const format = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN');

  const summary = coachingByMonth(
    months,
    access.user_id,
    visits.data ?? [],
    new Map((scores.data ?? []).map((entry) => [entry.visitId, entry])),
    (debriefs.data ?? []).map((entry) => ({
      createdAt: entry.createdAt,
      checks: checksMet(entry),
    })),
  );
  const labels = monthLabels(months, language);
  const point = (month: string, index: number, value: number | null) => ({
    key: month,
    label: labels[index] ?? month,
    value,
  });
  const shared = {
    tableLabel: t('progress.asTable'),
    monthHeader: t('progress.month'),
    hint: t('progress.hint'),
    missing: t('progress.none'),
  };

  return (
    <div className="container-page space-y-6 py-8">
      <Link
        to="/app/crp"
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('visits.plan.back')}
      </Link>
      <PageHeader title={t('progress.mine.title')} description={t('progress.mine.description')} />
      <QueryState
        isPending={visits.isPending}
        isError={visits.isError}
        onRetry={() => void visits.refetch()}
      >
        <Card aria-labelledby="mine-visits">
          <CardHeader
            titleId="mine-visits"
            title={
              <span className="inline-flex items-center gap-2">
                <Gauge className="size-5 text-primary" aria-hidden="true" />
                {t('progress.mine.visits')}
              </span>
            }
          />
          <CardBody className="space-y-8">
            <ValueTrend
              kind="columns"
              title={t('progress.mine.changed')}
              points={summary.map((row, index) =>
                point(row.month, index, percent(row.practised, row.followUps)),
              )}
              maximum={100}
              valueHeader={t('progress.area.changedHeader')}
              format={(value) => `${format.format(value)}%`}
              {...shared}
            />
            <ValueTrend
              kind="line"
              title={t('progress.mine.score')}
              points={summary.map((row, index) => point(row.month, index, row.averageScore))}
              maximum={12}
              valueHeader={t('progress.area.scoreHeader')}
              format={(value) => t('progress.outOf', { value: format.format(value), max: 12 })}
              {...shared}
            />
            <ValueTrend
              kind="columns"
              title={t('progress.mine.minutes')}
              points={summary.map((row, index) => point(row.month, index, row.minutesToFeedback))}
              valueHeader={t('progress.area.minutesHeader')}
              format={(value) => t('progress.minutes', { value: format.format(value) })}
              {...shared}
            />
            <p className="text-sm text-fg-muted">
              {t('progress.mine.thisMonth', {
                visits: summary.at(-1)?.visits ?? 0,
                followUps: summary.at(-1)?.followUps ?? 0,
              })}
            </p>
          </CardBody>
        </Card>
        <Card aria-labelledby="mine-rehearsals">
          <CardHeader
            titleId="mine-rehearsals"
            title={
              <span className="inline-flex items-center gap-2">
                <MessagesSquare className="size-5 text-primary" aria-hidden="true" />
                {t('progress.mine.rehearsals')}
              </span>
            }
          />
          <CardBody>
            <ValueTrend
              kind="line"
              title={t('progress.mine.checks')}
              points={summary.map((row, index) => point(row.month, index, row.averageChecks))}
              maximum={5}
              valueHeader={t('progress.mine.checksHeader')}
              format={(value) => t('progress.outOf', { value: format.format(value), max: 5 })}
              {...shared}
            />
          </CardBody>
        </Card>
        <p className="text-sm text-fg-muted">{t('progress.mine.private')}</p>
      </QueryState>
    </div>
  );
}
