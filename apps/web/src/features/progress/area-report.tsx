import { useQuery } from '@tanstack/react-query';
import { BookOpenText, HandHeart, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { LevelTrend, ValueTrend } from '@/components/charts/trend-charts';
import { QueryState } from '@/features/workspaces/query-state';
import { areaReportQuery, type AreaPulseMonth, type AreaReport } from './progress-api';
import { LAKSHYA, monthLabel, monthLabels, percent } from './progress';

type ShownPulse = Extract<AreaPulseMonth, { withheld: false }>;

/** The classes of one grade and medium, month by month over the report's months. */
function PulseGroup({
  report,
  grade,
  language: medium,
}: {
  report: AreaReport;
  grade: number;
  language: string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const format = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN');
  const months = report.coaching.map((row) => row.month);
  const labels = monthLabels(months, language);
  const rows = report.pulse.filter((row) => row.grade === grade && row.language === medium);
  const shown = rows.filter((row): row is ShownPulse => !row.withheld);
  const withheld = rows.length - shown.length;
  const byMonth = new Map(shown.map((row) => [row.month.slice(0, 7), row]));
  const of = (month: string) => byMonth.get(month.slice(0, 7));
  const lakshya = LAKSHYA[grade];
  const latest = shown.at(-1);
  const limits = { classes: report.fewestClasses, schools: report.fewestSchools };

  return (
    <div className="space-y-5">
      <h3 className="font-semibold text-fg">
        {t('progress.area.group', {
          grade,
          language: t(`pulse.language.${medium}`, { defaultValue: medium }),
        })}
      </h3>
      {shown.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('progress.area.allWithheld', limits)}</p>
      ) : (
        <>
          <LevelTrend
            title={t('progress.area.levelsTitle')}
            points={months.map((month, index) => {
              const row = of(month);
              return {
                key: month,
                label: labels[index] ?? month,
                counts: row
                  ? { needsSupport: row.needsSupport, hesitant: row.hesitant, fluent: row.fluent }
                  : null,
              };
            })}
            names={{
              needsSupport: t('visits.level.reading.needs_support'),
              hesitant: t('visits.level.reading.hesitant'),
              fluent: t('visits.level.reading.fluent'),
              checked: t('progress.checked'),
            }}
            tableLabel={t('progress.asTable')}
            monthHeader={t('progress.month')}
            hint={t('progress.hint')}
            missing={t('progress.area.withheld')}
          />
          {lakshya !== undefined &&
          shown.some((row) => row.speed !== null && row.speed.medianWcpm !== null) ? (
            <ValueTrend
              kind="line"
              title={t('progress.area.speedTitle')}
              points={months.map((month, index) => ({
                key: month,
                label: labels[index] ?? month,
                value: of(month)?.speed?.medianWcpm ?? null,
              }))}
              valueHeader={t('progress.wcpmHeader')}
              format={(value) => t('progress.wcpm', { value: format.format(value) })}
              reference={{
                value: lakshya,
                label: t('progress.lakshya', { value: lakshya, grade }),
              }}
              tableLabel={t('progress.asTable')}
              monthHeader={t('progress.month')}
              hint={t('progress.hint')}
              missing={t('progress.area.withheld')}
            />
          ) : null}
          {lakshya !== undefined &&
          shown.some((row) => row.speed !== null && row.speed.medianWcpm !== null) ? (
            <p className="text-sm text-fg-muted">{t('progress.area.speedNote')}</p>
          ) : null}
          {latest ? (
            <p className="text-sm text-fg">
              {t('progress.area.latest', {
                month: monthLabel(latest.month, language, true),
                checked: latest.checked,
                classes: latest.classes,
                independent: percent(latest.independent, latest.checked) ?? 0,
              })}
              {latest.speed && latest.speed.timed > 0
                ? ` ${t('progress.area.metLakshya', {
                    share: percent(latest.speed.atLakshya, latest.speed.timed) ?? 0,
                    value: latest.speed.lakshya,
                  })}`
                : ''}
            </p>
          ) : null}
          {withheld > 0 ? (
            <p className="text-sm text-fg-muted">
              {t('progress.area.someWithheld', { count: withheld, ...limits })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The report from its first month with any record: months before the area had any are left out. */
function fromFirstRecord(report: AreaReport): AreaReport {
  const start = report.coaching.findIndex(
    (row) =>
      row.visitsDone !== null ||
      row.followUps !== null ||
      row.feedbackScore !== null ||
      row.timeToFeedback !== null ||
      report.pulse.some((entry) => entry.month.slice(0, 7) === row.month.slice(0, 7)),
  );
  return start > 0 ? { ...report, coaching: report.coaching.slice(start) } : report;
}

/**
 * What an education office sees of its area: mentoring measured by what changed, and the Pulse
 * against NIPUN Bharat's Lakshya. Finished months only, and only totals over enough classes,
 * schools and CRPs that none of them can be made out; no ranking.
 */
export function AreaReportSection() {
  const { t, i18n } = useTranslation();
  const report = useQuery(areaReportQuery());
  const language = i18n.language;
  const format = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN');
  const data = report.data ? fromFirstRecord(report.data) : null;
  const labels = monthLabels(data?.coaching.map((row) => row.month) ?? [], language);
  const point = (month: string, index: number, value: number | null) => ({
    key: month,
    label: labels[index] ?? month,
    value,
  });
  const groups = [
    ...new Map(
      (data?.pulse ?? []).map((row) => [`${String(row.grade)}-${row.language}`, row]),
    ).values(),
  ].sort((a, b) => a.grade - b.grade || a.language.localeCompare(b.language));
  const last = data?.coaching.at(-1);

  return (
    <QueryState
      isPending={report.isPending}
      isError={report.isError}
      onRetry={() => void report.refetch()}
    >
      {data ? (
        <div className="space-y-6">
          <Card aria-labelledby="area-coaching">
            <CardHeader
              titleId="area-coaching"
              title={
                <span className="inline-flex items-center gap-2">
                  <HandHeart className="size-5 text-primary" aria-hidden="true" />
                  {t('progress.area.coaching')}
                </span>
              }
              description={t('progress.area.coachingBody')}
            />
            <CardBody className="space-y-8">
              <ValueTrend
                kind="line"
                title={t('progress.area.changed')}
                points={data.coaching.map((row, index) =>
                  point(
                    row.month,
                    index,
                    row.followUps
                      ? percent(
                          row.followUps.practised,
                          row.followUps.practised + row.followUps.partly + row.followUps.notYet,
                        )
                      : null,
                  ),
                )}
                maximum={100}
                valueHeader={t('progress.area.changedHeader')}
                format={(value) => `${format.format(value)}%`}
                tableLabel={t('progress.asTable')}
                monthHeader={t('progress.month')}
                hint={t('progress.area.changedHint')}
                missing={t('progress.area.withheld')}
              />
              <ValueTrend
                kind="line"
                title={t('progress.area.score')}
                points={data.coaching.map((row, index) =>
                  point(row.month, index, row.feedbackScore?.average ?? null),
                )}
                maximum={12}
                valueHeader={t('progress.area.scoreHeader')}
                format={(value) => t('progress.outOf', { value: format.format(value), max: 12 })}
                tableLabel={t('progress.asTable')}
                monthHeader={t('progress.month')}
                hint={t('progress.hint')}
                missing={t('progress.area.withheld')}
              />
              <ValueTrend
                kind="columns"
                title={t('progress.area.minutes')}
                points={data.coaching.map((row, index) =>
                  point(row.month, index, row.timeToFeedback?.medianMinutes ?? null),
                )}
                valueHeader={t('progress.area.minutesHeader')}
                format={(value) => t('progress.minutes', { value: format.format(value) })}
                tableLabel={t('progress.asTable')}
                monthHeader={t('progress.month')}
                hint={t('progress.hint')}
                missing={t('progress.area.withheld')}
              />
              {last ? (
                <p className="text-sm text-fg-muted">
                  {last.visitsDone
                    ? t('progress.area.visits', {
                        month: monthLabel(last.month, language, true),
                        visits: last.visitsDone.visits,
                        classes: last.visitsDone.classes,
                      })
                    : t('progress.area.visitsWithheld', {
                        month: monthLabel(last.month, language, true),
                      })}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card aria-labelledby="area-pulse">
            <CardHeader
              titleId="area-pulse"
              title={
                <span className="inline-flex items-center gap-2">
                  <BookOpenText className="size-5 text-primary" aria-hidden="true" />
                  {t('progress.area.pulse')}
                </span>
              }
              description={t('progress.area.pulseBody')}
            />
            <CardBody className="space-y-8">
              {groups.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('progress.area.noPulse')}</p>
              ) : (
                groups.map((group) => (
                  <PulseGroup
                    key={`${String(group.grade)}-${group.language}`}
                    report={data}
                    grade={group.grade}
                    language={group.language}
                  />
                ))
              )}
            </CardBody>
          </Card>

          <p className="inline-flex items-start gap-2 text-sm text-fg-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('progress.area.privacy', {
              classes: data.fewestClasses,
              schools: data.fewestSchools,
              crps: data.fewestCrps,
              areaSchools: data.schools,
              areaClasses: data.classes,
            })}
          </p>
        </div>
      ) : null}
    </QueryState>
  );
}
