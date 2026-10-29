import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, BookOpenText, CalendarCheck, NotebookPen, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ValueTrend } from '@/components/charts/trend-charts';
import { formatDay } from '@/features/attendance/dates';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { childProgressQuery } from './progress-api';
import { LAKSHYA, lastMonths, monthLabel, monthLabels, percent } from './progress';

const LEVEL_TONE = { fluent: 'success', hesitant: 'warning', needs_support: 'danger' } as const;

/** One child's reading, marks and attendance over the months, for their teachers and CRP. */
export function ChildProgressPage({ studentId }: { studentId: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const progress = useQuery(childProgressQuery(studentId));
  const data = progress.data;
  useDocumentTitle(t('progress.child.title'));
  const language = i18n.language;
  const format = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN');

  const back = (
    <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
      <ArrowLeft aria-hidden="true" />
      {t('progress.back')}
    </Button>
  );

  if (!data) {
    return (
      <div className="container-page space-y-5 py-8">
        {back}
        <QueryState
          isPending={progress.isPending}
          isError={progress.isError}
          onRetry={() => void progress.refetch()}
        >
          <EmptyState icon={UserRound} title={t('progress.child.notFound')} />
        </QueryState>
      </div>
    );
  }

  const months = lastMonths(todayInIndia(), 6);
  const attendanceLabels = monthLabels(months, language);
  const attendance = months.map((month, index) => {
    const entry = data.attendance.find((row) => row.month.slice(0, 7) === month.slice(0, 7));
    return {
      key: month,
      label: attendanceLabels[index] ?? month,
      value: entry ? percent(entry.present, entry.marked) : null,
    };
  });
  const speeds = data.pulse.filter((row) => row.wcpm !== null);
  const speedLabels = monthLabels(
    speeds.map((row) => row.month),
    language,
  );
  // The Lakshya differs by class: its line is drawn only when every speed is of one class.
  const grades = new Set(speeds.map((row) => row.grade));
  const grade = grades.size === 1 ? (speeds[0]?.grade ?? null) : null;
  const lakshya = grade === null ? undefined : LAKSHYA[grade];

  return (
    <div className="container-page space-y-6 py-8">
      {back}
      <PageHeader
        title={data.student.fullName}
        description={t('progress.child.description', { code: data.student.studentCode })}
      />

      <Card aria-labelledby="child-reading">
        <CardHeader
          titleId="child-reading"
          title={
            <span className="inline-flex items-center gap-2">
              <BookOpenText className="size-5 text-primary" aria-hidden="true" />
              {t('progress.child.reading')}
            </span>
          }
          description={t('progress.child.readingBody')}
        />
        <CardBody className="space-y-5">
          {data.pulse.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('progress.child.noPulse')}</p>
          ) : (
            <ol className="space-y-2">
              {data.pulse.map((row, index) => (
                <li
                  key={`${row.month}-${String(row.grade)}-${String(index)}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="w-20 text-fg-muted">
                    {monthLabel(row.month, language, true)}
                  </span>
                  {row.reading ? (
                    <Badge tone={LEVEL_TONE[row.reading]}>
                      {t(`visits.level.reading.${row.reading}`)}
                    </Badge>
                  ) : null}
                  {row.wcpm !== null ? (
                    <span className="text-fg tabular-nums">
                      {t('progress.wcpm', { value: format.format(row.wcpm) })}
                    </span>
                  ) : null}
                  <span className="text-fg-muted">{t(`progress.source.${row.source}`)}</span>
                </li>
              ))}
            </ol>
          )}
          {speeds.length > 1 ? (
            <ValueTrend
              kind="line"
              title={t('progress.child.speedTitle')}
              points={speeds.map((row, index) => ({
                key: `${row.month}-${String(row.grade)}-${String(index)}`,
                label: speedLabels[index] ?? row.month,
                value: row.wcpm,
              }))}
              valueHeader={t('progress.wcpmHeader')}
              format={(value) => t('progress.wcpm', { value: format.format(value) })}
              reference={
                lakshya
                  ? { value: lakshya, label: t('progress.lakshya', { value: lakshya, grade }) }
                  : undefined
              }
              tableLabel={t('progress.asTable')}
              monthHeader={t('progress.month')}
              hint={t('progress.hint')}
              missing={t('progress.none')}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card aria-labelledby="child-marks">
        <CardHeader
          titleId="child-marks"
          title={
            <span className="inline-flex items-center gap-2">
              <NotebookPen className="size-5 text-primary" aria-hidden="true" />
              {t('progress.child.marks')}
            </span>
          }
        />
        <CardBody>
          {data.marks.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('progress.child.noMarks')}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('progress.child.marks')}</caption>
              <thead>
                <tr className="text-fg-muted">
                  <th scope="col" className="py-1.5 pe-3 font-medium">
                    {t('progress.child.date')}
                  </th>
                  <th scope="col" className="py-1.5 pe-3 font-medium">
                    {t('family.results.subject')}
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    {t('family.results.result')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...data.marks].reverse().map((row, index) => (
                  <tr
                    key={`${row.heldOn}-${row.subject}-${String(index)}`}
                    className="border-t border-border"
                  >
                    <td className="py-1.5 pe-3 text-fg-muted">{formatDay(row.heldOn, language)}</td>
                    <th scope="row" className="py-1.5 pe-3 font-medium text-fg">
                      {row.subject === 'other' && row.subjectName
                        ? row.subjectName
                        : t(`exams.subject.${row.subject}`, { defaultValue: row.subject })}
                    </th>
                    <td className="py-1.5 text-fg tabular-nums">
                      {row.absent
                        ? t('family.results.absent')
                        : row.percent === null
                          ? t('progress.none')
                          : `${format.format(row.percent)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card aria-labelledby="child-attendance">
        <CardHeader
          titleId="child-attendance"
          title={
            <span className="inline-flex items-center gap-2">
              <CalendarCheck className="size-5 text-primary" aria-hidden="true" />
              {t('progress.child.attendance')}
            </span>
          }
        />
        <CardBody>
          {data.attendance.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('progress.child.noAttendance')}</p>
          ) : (
            <ValueTrend
              kind="columns"
              title={t('progress.child.attendanceTitle')}
              points={attendance}
              maximum={100}
              valueHeader={t('progress.presentHeader')}
              format={(value) => `${format.format(value)}%`}
              tableLabel={t('progress.asTable')}
              monthHeader={t('progress.month')}
              hint={t('progress.hint')}
              missing={t('progress.none')}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
