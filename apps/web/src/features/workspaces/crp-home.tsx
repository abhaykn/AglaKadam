import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  LineChart,
  ListTodo,
  MessagesSquare,
  NotebookPen,
  QrCode,
  RotateCcw,
  School,
  Target,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classDetailsQuery, classRosterQuery } from '@/features/attendance/attendance-api';
import { formatDay } from '@/features/attendance/dates';
import { scopesFor } from '@/features/auth/access';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { pulseWeekCodesQuery } from '@/features/pulse/pulse-api';
import { addDays, planWeek, rankClasses } from '@/features/visits/plan';
import {
  classPulseChecksQuery,
  crpSignalQuery,
  crpTasksQuery,
  openRequestQuery,
  schoolsOverviewQuery,
  schoolTeachersQuery,
  useClusterVisits,
} from '@/features/visits/visit-api';
import { reasonText, useSchoolName } from '@/features/visits/visit-hooks';
import { BandBadge } from '@/features/visits/visit-ui';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { classLabel } from './grade-label';
import { PageHeader } from './page-header';
import { QueryState } from './query-state';

/** How many of the top-ranked classes are prepared on the device ahead of the week. */
const PREPARED_CLASSES = 12;

export function CrpHome() {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const localise = useLocalisedName();
  const clusters = scopesFor(access, 'crp');
  const overview = useQuery(schoolsOverviewQuery());
  const signals = useQuery(crpSignalQuery());
  const visits = useClusterVisits();
  const tasks = useQuery(crpTasksQuery());
  const schoolName = useSchoolName();
  const number = new Intl.NumberFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN');
  useDocumentTitle(t('workspaces.crp'));
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const today = todayInIndia();
  const week = planWeek(today);
  // On a Sunday the plan is for the coming week, in which nothing can have been done yet.
  const comingWeek = today < week.start;
  // Visits can be planned into the next week: the card shows the next seven days, so that late in
  // the week the ones already planned for Monday onwards are in sight.
  const horizon = addDays(today, 6);

  const ranked = rankClasses(signals.data ?? [], tasks.data ?? [], today);
  const upcoming = (visits.data ?? [])
    .filter(
      (visit) => visit.status === 'planned' && visit.plannedOn !== null && visit.plannedOn >= today,
    )
    .sort((a, b) => (a.plannedOn ?? '').localeCompare(b.plannedOn ?? ''));
  const planned = upcoming.filter((visit) => (visit.plannedOn ?? '') <= horizon);
  const doneThisWeek = (visits.data ?? []).filter(
    (visit) =>
      visit.status === 'done' &&
      visit.visitedOn !== null &&
      visit.visitedOn >= week.start &&
      visit.visitedOn <= week.end,
  ).length;
  // A class already planned, however far ahead, is not suggested again.
  const plannedClasses = new Set(upcoming.map((visit) => visit.classSectionId));
  const next = ranked
    .filter((entry) => !plannedClasses.has(entry.signal.classSectionId) && entry.score > 0)
    .slice(0, 3);
  const checkBacks = (signals.data ?? [])
    .filter((signal) => signal.checkBackOn !== null && signal.checkBackOn <= week.end)
    .sort((a, b) => (a.checkBackOn ?? '').localeCompare(b.checkBackOn ?? ''));
  const openTasks = (tasks.data ?? []).filter(
    (task) => !task.done && task.dueOn !== null && task.dueOn <= week.end,
  );
  const toListen = (signals.data ?? []).reduce((sum, signal) => sum + signal.toListen, 0);
  const signalOf = (classSectionId: string) =>
    signals.data?.find((entry) => entry.classSectionId === classSectionId);

  // The classes whose visit pack the device keeps: those planned, and the best ranked.
  const preparedIds = [
    ...new Set([
      ...planned.map((visit) => visit.classSectionId),
      ...ranked.slice(0, PREPARED_CLASSES).map((entry) => entry.signal.classSectionId),
    ]),
  ].join(',');

  // While there is a network, keeps on the device everything the week's visits need: the Pulse
  // unlock codes, the visit packs and the teachers of each school.
  useEffect(() => {
    if (!isOnline) {
      return;
    }
    queryClient.query(pulseWeekCodesQuery()).catch(() => undefined);
    for (const classId of preparedIds.split(',').filter(Boolean)) {
      queryClient.query(classDetailsQuery(classId)).catch(() => undefined);
      queryClient.query(classRosterQuery(classId)).catch(() => undefined);
      queryClient.query(classPulseChecksQuery(classId)).catch(() => undefined);
      queryClient.query(openRequestQuery(classId)).catch(() => undefined);
    }
    for (const school of overview.data ?? []) {
      queryClient.query(schoolTeachersQuery(school.school_id)).catch(() => undefined);
    }
  }, [isOnline, queryClient, preparedIds, overview.data]);

  return (
    <div className="container-page space-y-6 py-8">
      <PageHeader
        title={t('home.greeting', { name: access.full_name })}
        description={t('home.crpDescription', {
          clusters: clusters.map((cluster) => localise(cluster)).join(', '),
        })}
        actions={
          <>
            <Button asChild>
              <Link to="/app/crp/plan">
                <CalendarDays aria-hidden="true" />
                {t('visits.home.plan')}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/app/crp/tasks">
                <ListTodo aria-hidden="true" />
                {t('visits.home.tasks')}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/app/crp/exams">
                <NotebookPen aria-hidden="true" />
                {t('visits.home.exams')}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/app/crp/growth">
                <LineChart aria-hidden="true" />
                {t('progress.mine.open')}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/app/crp/rehearse">
                <MessagesSquare aria-hidden="true" />
                {t('sahayak.rehearsal.open')}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/app/practices">
                <BookOpenCheck aria-hidden="true" />
                {t('visits.home.library')}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/app/crp/pulse-codes">
                <QrCode aria-hidden="true" />
                {t('pulse.codes.open')}
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card aria-labelledby="week-title">
          <CardHeader
            titleId="week-title"
            title={
              <span className="inline-flex items-center gap-2">
                <CalendarCheck className="size-5 text-primary" aria-hidden="true" />
                {t('visits.home.weekTitle')}
              </span>
            }
            description={
              comingWeek
                ? t('visits.home.comingWeekBody', {
                    planned: t('visits.home.weekPlanned', { count: planned.length }),
                  })
                : t('visits.home.weekBody', {
                    planned: t('visits.home.weekPlanned', { count: planned.length }),
                    done: t('visits.home.weekDone', { count: doneThisWeek }),
                  })
            }
          />
          <QueryState
            isPending={visits.isPending}
            isError={visits.isError}
            onRetry={() => void visits.refetch()}
          >
            {planned.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">{t('visits.home.noneThisWeek')}</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {planned.map((visit) => {
                  const signal = signalOf(visit.classSectionId);
                  return (
                    <li
                      key={visit.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-fg">
                          {signal ? classLabel(t, signal.grade, signal.section) : ''} ·{' '}
                          {schoolName(visit.schoolId)}
                        </p>
                        <p className="text-sm text-fg-muted">
                          {visit.plannedOn ? formatDay(visit.plannedOn, i18n.language) : ''}
                        </p>
                      </div>
                      <Button asChild variant="secondary">
                        <Link
                          to="/app/crp/class/$classId"
                          params={{ classId: visit.classSectionId }}
                        >
                          {t('visits.home.openPack')}
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryState>
        </Card>

        <Card aria-labelledby="next-title">
          <CardHeader
            titleId="next-title"
            title={
              <span className="inline-flex items-center gap-2">
                <Target className="size-5 text-primary" aria-hidden="true" />
                {t('visits.home.nextTitle')}
              </span>
            }
            description={t('visits.home.nextBody')}
          />
          <QueryState
            isPending={signals.isPending}
            isError={signals.isError}
            onRetry={() => void signals.refetch()}
          >
            {next.length === 0 ? (
              <CardBody>
                <p className="text-sm text-fg-muted">{t('visits.home.nothingNext')}</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {next.map((entry) => (
                  <li
                    key={entry.signal.classSectionId}
                    className="flex items-start justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                        {classLabel(t, entry.signal.grade, entry.signal.section)} ·{' '}
                        {schoolName(entry.signal.schoolId)}
                        <BandBadge band={entry.band} />
                      </p>
                      {entry.reasons[0] ? (
                        <p className="text-sm text-fg-muted">
                          {reasonText(entry.reasons[0], t, i18n.language)}
                        </p>
                      ) : null}
                    </div>
                    <Button asChild variant="secondary">
                      <Link
                        to="/app/crp/class/$classId"
                        params={{ classId: entry.signal.classSectionId }}
                      >
                        {t('visits.home.openPack')}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>
      </div>

      {checkBacks.length > 0 || openTasks.length > 0 || toListen > 0 ? (
        <Card>
          <CardBody className="flex flex-wrap gap-3">
            {checkBacks.length > 0 ? (
              <Badge tone="brand">
                <RotateCcw aria-hidden="true" />
                {t('visits.home.checkBacks', { count: checkBacks.length })}
              </Badge>
            ) : null}
            {openTasks.length > 0 ? (
              <Badge tone="warning">
                <ListTodo aria-hidden="true" />
                {t('visits.home.tasksDue', { count: openTasks.length })}
              </Badge>
            ) : null}
            {toListen > 0 ? (
              <Badge tone="info">{t('visits.home.toListen', { count: toListen })}</Badge>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {clusters.map((cluster) => {
        const schools = (overview.data ?? []).filter((row) => row.cluster_id === cluster.id);
        return (
          <Card key={cluster.id} aria-labelledby={`cluster-${cluster.id}`}>
            <CardHeader
              titleId={`cluster-${cluster.id}`}
              title={localise(cluster)}
              description={t('home.clusterCode', { code: cluster.code })}
            />
            <QueryState
              isPending={overview.isPending}
              isError={overview.isError}
              onRetry={() => void overview.refetch()}
            >
              {schools.length === 0 ? (
                <EmptyState
                  icon={School}
                  title={t('home.noSchools.title')}
                  description={t('home.noSchools.body')}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <caption className="sr-only">{t('home.schoolsTableCaption')}</caption>
                    <thead className="border-b border-border text-fg-muted">
                      <tr>
                        <th scope="col" className="px-5 py-3 font-medium">
                          {t('home.columns.school')}
                        </th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">
                          {t('home.columns.teachers')}
                        </th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">
                          {t('home.columns.classes')}
                        </th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">
                          {t('home.columns.students')}
                        </th>
                        <th scope="col" className="px-5 py-3 text-right font-medium">
                          {t('home.columns.pending')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {schools.map((school) => (
                        <tr key={school.school_id}>
                          <th scope="row" className="px-5 py-3 font-medium text-fg">
                            {localise(school)}
                            <span className="block text-xs font-normal text-fg-muted tabular-nums">
                              {school.udise_code}
                            </span>
                          </th>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {number.format(school.teachers)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {number.format(school.current_classes)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {number.format(school.active_students)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {number.format(school.pending_students)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </QueryState>
          </Card>
        );
      })}
    </div>
  );
}
