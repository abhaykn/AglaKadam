import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, CalendarDays, CalendarPlus, Info, School, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { formatDay } from '@/features/attendance/dates';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { newVisit, stepToFollowUp } from './visit-builders';
import { bySchool, plannedDays, rankClasses, workingDaysFrom, type RankedClass } from './plan';
import {
  crpSignalQuery,
  crpTasksQuery,
  useClusterVisits,
  useRemovePlannedVisit,
  useSaveVisit,
} from './visit-api';
import { BandBadge, ReasonList } from './visit-ui';
import { useSchoolName } from './visit-hooks';

export function PlanPage() {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const today = todayInIndia();
  // The next six school days from today: the days already gone this week have nothing left to
  // plan, and late in the week the plan runs on into the next one.
  const schoolDays = workingDaysFrom(today, 6);
  const week = { start: schoolDays[0] ?? today, end: schoolDays.at(-1) ?? today, days: schoolDays };
  const signals = useQuery(crpSignalQuery());
  const visits = useClusterVisits();
  const tasks = useQuery(crpTasksQuery());
  const schoolName = useSchoolName();
  const save = useSaveVisit();
  const remove = useRemovePlannedVisit();
  const [choosing, setChoosing] = useState<RankedClass | null>(null);
  // A second tap while a visit is being kept must not plan it twice.
  const [busy, setBusy] = useState(false);
  useDocumentTitle(t('visits.plan.title'));

  const ranked = rankClasses(signals.data ?? [], tasks.data ?? [], today);
  const planned = (visits.data ?? []).filter(
    (visit) => visit.status === 'planned' && visit.plannedOn !== null,
  );
  const days = plannedDays(
    week,
    planned.map((visit) => visit.plannedOn ?? ''),
  );
  const plannedClasses = new Set(
    planned
      .filter((visit) => (visit.plannedOn ?? '') >= today)
      .map((visit) => visit.classSectionId),
  );
  const schools = bySchool(
    ranked.filter((entry) => !plannedClasses.has(entry.signal.classSectionId)),
  );
  const signalOf = (classSectionId: string) =>
    signals.data?.find((entry) => entry.classSectionId === classSectionId);

  const plan = async (entry: RankedClass, day: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const visit = newVisit({
        classSectionId: entry.signal.classSectionId,
        schoolId: entry.signal.schoolId,
        crpId: access.user_id,
        signal: entry.signal,
        followsVisit: stepToFollowUp(visits.data ?? [], entry.signal.classSectionId),
        requestId: null,
        plannedOn: day,
        today,
      });
      if (await save(visit, { grade: entry.signal.grade, section: entry.signal.section })) {
        setChoosing(null);
      }
    } finally {
      setBusy(false);
    }
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
      <PageHeader
        title={t('visits.plan.title')}
        description={t('visits.plan.description', {
          start: formatDay(week.start, i18n.language),
          end: formatDay(week.end, i18n.language),
        })}
      />

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-5 text-primary" aria-hidden="true" />
              {t('visits.plan.weekTitle')}
            </span>
          }
        />
        <QueryState
          isPending={visits.isPending}
          isError={visits.isError}
          onRetry={() => void visits.refetch()}
        >
          <ul className="divide-y divide-border">
            {days.map((day) => {
              const ofDay = planned.filter((visit) => visit.plannedOn === day);
              return (
                <li key={day} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start">
                  <span className="w-32 shrink-0 font-medium text-fg">
                    {formatDay(day, i18n.language)}
                  </span>
                  {ofDay.length === 0 ? (
                    <span className="text-sm text-fg-muted">{t('visits.plan.nothingPlanned')}</span>
                  ) : (
                    <ul className="flex-1 space-y-2">
                      {ofDay.map((visit) => {
                        const signal = signalOf(visit.classSectionId);
                        const name = signal
                          ? classLabel(t, signal.grade, signal.section)
                          : t('visits.pack.title');
                        return (
                          <li
                            key={visit.id}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <Link
                              to="/app/crp/class/$classId"
                              params={{ classId: visit.classSectionId }}
                              className="inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline"
                            >
                              {name} · {schoolName(visit.schoolId)}
                            </Link>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t('visits.plan.unplan', { class: name })}
                              onClick={() =>
                                void remove({
                                  visitId: visit.id,
                                  classSectionId: visit.classSectionId,
                                  plannedOn: visit.plannedOn ?? today,
                                  classLabel: signal
                                    ? { grade: signal.grade, section: signal.section }
                                    : null,
                                })
                              }
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </QueryState>
      </Card>

      <section aria-labelledby="ranked-title" className="space-y-4">
        <div className="space-y-1">
          <h2 id="ranked-title" className="text-lg font-semibold text-fg">
            {t('visits.plan.rankedTitle')}
          </h2>
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('visits.plan.rankedBody')}
          </p>
        </div>
        <QueryState
          isPending={signals.isPending}
          isError={signals.isError}
          onRetry={() => void signals.refetch()}
        >
          {schools.length === 0 ? (
            <EmptyState
              icon={School}
              title={t('visits.plan.empty.title')}
              description={t('visits.plan.empty.body')}
            />
          ) : (
            schools.map((school) => (
              <Card key={school.schoolId} aria-labelledby={`plan-school-${school.schoolId}`}>
                <CardHeader
                  titleId={`plan-school-${school.schoolId}`}
                  title={schoolName(school.schoolId)}
                />
                <ul className="divide-y divide-border">
                  {school.classes.map((entry) => {
                    const name = classLabel(t, entry.signal.grade, entry.signal.section);
                    return (
                      <li
                        key={entry.signal.classSectionId}
                        className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-fg">{name}</span>
                            <BandBadge band={entry.band} />
                            <span className="text-xs text-fg-muted tabular-nums">
                              {t('visits.plan.score', { score: entry.score })}
                            </span>
                          </div>
                          <ReasonList reasons={entry.reasons} />
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setChoosing(entry)}>
                            <CalendarPlus aria-hidden="true" />
                            {t('visits.plan.add')}
                          </Button>
                          <Button asChild>
                            <Link
                              to="/app/crp/class/$classId"
                              params={{ classId: entry.signal.classSectionId }}
                            >
                              {t('visits.plan.open')}
                            </Link>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
        </QueryState>
      </section>

      <Dialog open={choosing !== null} onOpenChange={(open) => (open ? null : setChoosing(null))}>
        {choosing ? (
          <DialogContent
            title={t('visits.pack.planTitle')}
            description={`${classLabel(t, choosing.signal.grade, choosing.signal.section)} · ${schoolName(choosing.signal.schoolId)}`}
          >
            <CardBody className="grid grid-cols-2 gap-2 p-0 sm:grid-cols-3">
              {workingDaysFrom(today, 9).map((day) => (
                <Button
                  key={day}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void plan(choosing, day)}
                >
                  {formatDay(day, i18n.language)}
                </Button>
              ))}
            </CardBody>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
