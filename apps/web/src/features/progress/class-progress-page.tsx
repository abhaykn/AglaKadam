import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, ArrowUp, Minus, Sparkles, TrendingUp, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { EmptyState } from '@/components/ui/empty-state';
import { LevelTrend } from '@/components/charts/trend-charts';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { classProgressQuery } from './progress-api';
import { monthLabels, monthsSpanning, movementOf, percent } from './progress';

const LEVEL_TONE = { fluent: 'success', hesitant: 'warning', needs_support: 'danger' } as const;

/**
 * A class's reading month by month, the children who moved up a level (the class's bright spots),
 * and each child's latest level, speed, attendance and marks, for its teachers and CRP.
 */
export function ClassProgressPage({ classSectionId }: { classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const localise = useLocalisedName();
  const details = useQuery(classDetailsQuery(classSectionId));
  const progress = useQuery(classProgressQuery(classSectionId));
  useDocumentTitle(t('progress.class.title'));
  const language = i18n.language;
  const format = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN');
  const data = progress.data;

  const title = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('exams.classFallback');
  const brightSpots = (data?.children ?? []).filter(
    (child) => movementOf(child.previous, child.latest) === 'up',
  );

  return (
    <div className="container-page space-y-6 py-8">
      <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
        <ArrowLeft aria-hidden="true" />
        {t('progress.back')}
      </Button>
      <PageHeader
        title={t('progress.class.heading', { class: title })}
        description={details.data ? localise(details.data.school) : undefined}
      />
      <QueryState
        isPending={progress.isPending}
        isError={progress.isError}
        onRetry={() => void progress.refetch()}
      >
        {!data ? (
          <EmptyState icon={Users} title={t('progress.class.notFound')} />
        ) : (
          <>
            <Card aria-labelledby="class-trend">
              <CardHeader
                titleId="class-trend"
                title={
                  <span className="inline-flex items-center gap-2">
                    <TrendingUp className="size-5 text-primary" aria-hidden="true" />
                    {t('progress.class.trend')}
                  </span>
                }
                description={t('progress.class.trendBody')}
              />
              <CardBody>
                {data.months.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t('progress.class.noPulse')}</p>
                ) : (
                  <LevelTrend
                    title={t('progress.class.levelsTitle')}
                    points={(() => {
                      // A month without a check keeps its place, shown as having none.
                      const months = monthsSpanning(data.months.map((month) => month.month));
                      const labels = monthLabels(months, language);
                      return months.map((key, index) => {
                        const month = data.months.find(
                          (entry) => entry.month.slice(0, 7) === key.slice(0, 7),
                        );
                        return {
                          key,
                          label: labels[index] ?? key,
                          counts: month
                            ? {
                                needsSupport: month.needsSupport,
                                hesitant: month.hesitant,
                                fluent: month.fluent,
                              }
                            : null,
                        };
                      });
                    })()}
                    names={{
                      needsSupport: t('visits.level.reading.needs_support'),
                      hesitant: t('visits.level.reading.hesitant'),
                      fluent: t('visits.level.reading.fluent'),
                      checked: t('progress.checked'),
                    }}
                    tableLabel={t('progress.asTable')}
                    monthHeader={t('progress.month')}
                    hint={t('progress.hint')}
                    missing={t('progress.none')}
                  />
                )}
              </CardBody>
            </Card>

            {brightSpots.length > 0 ? (
              <Card aria-labelledby="bright-spots">
                <CardHeader
                  titleId="bright-spots"
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="size-5 text-primary" aria-hidden="true" />
                      {t('progress.class.brightSpots', { count: brightSpots.length })}
                    </span>
                  }
                  description={t('progress.class.brightSpotsBody')}
                />
                <CardBody>
                  <ul className="flex flex-wrap gap-2">
                    {brightSpots.map((child) => (
                      <li key={child.studentId}>
                        <Link
                          to="/app/child/$studentId"
                          params={{ studentId: child.studentId }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-sm text-fg hover:underline"
                        >
                          <ArrowUp className="size-3.5 text-success" aria-hidden="true" />
                          {child.fullName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}

            <Card aria-labelledby="class-children">
              <CardHeader
                titleId="class-children"
                title={t('progress.class.children')}
                description={t('progress.class.childrenBody')}
              />
              {data.children.length === 0 ? (
                <EmptyState icon={Users} title={t('progress.class.noChildren')} />
              ) : (
                <CardBody className="overflow-x-auto">
                  <table className="w-full min-w-max text-left text-sm">
                    <caption className="sr-only">{t('progress.class.children')}</caption>
                    <thead>
                      <tr className="text-xs tracking-wide text-fg-muted uppercase">
                        <th scope="col" className="py-1.5 pe-3 font-medium">
                          {t('progress.class.child')}
                        </th>
                        <th scope="col" className="py-1.5 pe-3 font-medium">
                          {t('progress.class.level')}
                        </th>
                        <th scope="col" className="py-1.5 pe-3 font-medium">
                          {t('progress.wcpmHeader')}
                        </th>
                        <th scope="col" className="py-1.5 pe-3 font-medium">
                          {t('progress.presentHeader')}
                        </th>
                        <th scope="col" className="py-1.5 font-medium">
                          {t('progress.class.marks')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.children.map((child) => {
                        const movement = movementOf(child.previous, child.latest);
                        const present = percent(child.daysPresent, child.daysMarked);
                        return (
                          <tr
                            key={child.studentId}
                            className="border-t border-border transition-colors hover:bg-white/[0.04]"
                          >
                            <th scope="row" className="py-2.5 pe-4 font-medium">
                              <Link
                                to="/app/child/$studentId"
                                params={{ studentId: child.studentId }}
                                className="inline-flex items-center gap-2.5 text-fg hover:text-primary"
                              >
                                <span
                                  aria-hidden="true"
                                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg"
                                >
                                  {Array.from(child.fullName)[0]?.toUpperCase() ?? ''}
                                </span>
                                {child.fullName}
                              </Link>
                            </th>
                            <td className="py-2.5 pe-4">
                              {child.latest ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Badge tone={LEVEL_TONE[child.latest]}>
                                    {t(`visits.level.reading.${child.latest}`)}
                                  </Badge>
                                  {movement === 'up' ? (
                                    <ArrowUp
                                      className="size-4 text-success"
                                      aria-label={t('progress.movement.up')}
                                    />
                                  ) : movement === 'down' ? (
                                    <ArrowDown
                                      className="size-4 text-danger"
                                      aria-label={t('progress.movement.down')}
                                    />
                                  ) : movement === 'same' ? (
                                    <Minus
                                      className="size-4 text-fg-muted"
                                      aria-label={t('progress.movement.same')}
                                    />
                                  ) : null}
                                </span>
                              ) : (
                                <span className="text-fg-muted">
                                  {t('progress.class.notChecked')}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 pe-4 tabular-nums">
                              {child.wcpm === null ? '–' : format.format(child.wcpm)}
                            </td>
                            <td className="py-2.5 pe-4">
                              {present === null ? (
                                <span className="text-fg-muted">–</span>
                              ) : (
                                <Meter value={present} label={`${format.format(present)}%`} />
                              )}
                            </td>
                            <td className="py-2.5">
                              {child.marksPercent === null ? (
                                <span className="text-fg-muted">–</span>
                              ) : (
                                <Meter
                                  value={child.marksPercent}
                                  label={`${format.format(child.marksPercent)}%`}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-3 text-sm text-fg-muted">{t('progress.class.note')}</p>
                </CardBody>
              )}
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
