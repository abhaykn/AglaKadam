import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/use-document-title';
import { fetchAdminOverview, type AdminOverview } from './admin-api';

function Figure({ label, value }: { label: string; value: number }) {
  const { i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN');
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-bold text-fg tabular-nums">{number.format(value)}</dd>
    </div>
  );
}

/** Steps to make a new deployment usable, each ticked from the actual records. */
function SetupChecklist({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation();
  const steps: {
    key: 'academicYear' | 'schools' | 'crps' | 'teachers' | 'students';
    done: boolean;
    to: string;
  }[] = [
    {
      key: 'academicYear',
      done: overview.current_academic_year !== null,
      to: '/app/admin/academic-years',
    },
    { key: 'schools', done: overview.schools > 0, to: '/app/admin/schools' },
    { key: 'crps', done: (overview.staff.crp ?? 0) > 0, to: '/app/admin/staff' },
    { key: 'teachers', done: (overview.staff.teacher ?? 0) > 0, to: '/app/admin/staff' },
    { key: 'students', done: (overview.students.active ?? 0) > 0, to: '/app/admin/students' },
  ];
  if (steps.every((step) => step.done)) {
    return null;
  }
  return (
    <Card>
      <CardHeader
        title={t('admin.overview.setupTitle')}
        description={t('admin.overview.setupDescription')}
      />
      <CardBody>
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.key} className="flex items-start gap-3">
              {step.done ? (
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleDashed
                  className="mt-0.5 size-5 shrink-0 text-fg-subtle"
                  aria-hidden="true"
                />
              )}
              <div className={cn(step.done && 'text-fg-muted')}>
                <Link
                  to={step.to}
                  className="font-medium text-fg underline-offset-4 hover:underline"
                >
                  {t(`admin.overview.steps.${step.key}.title`)}
                </Link>
                <p className="text-sm text-fg-muted">
                  {t(`admin.overview.steps.${step.key}.body`)}
                </p>
                <span className="sr-only">
                  {step.done ? t('admin.overview.stepDone') : t('admin.overview.stepPending')}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: fetchAdminOverview });
  useDocumentTitle(t('admin.sections.overview'));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.overview.title')}
        description={
          overview.data?.current_academic_year
            ? t('admin.overview.currentYear', { label: overview.data.current_academic_year.label })
            : t('admin.overview.description')
        }
      />
      <QueryState
        isPending={overview.isPending}
        isError={overview.isError}
        onRetry={() => void overview.refetch()}
        rows={4}
      >
        {overview.data ? (
          <>
            <SetupChecklist overview={overview.data} />
            <section aria-labelledby="overview-geography" className="space-y-3">
              <h2 id="overview-geography" className="font-semibold text-fg">
                {t('admin.overview.geography')}
              </h2>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Figure label={t('admin.overview.districts')} value={overview.data.districts} />
                <Figure label={t('admin.overview.blocks')} value={overview.data.blocks} />
                <Figure label={t('admin.overview.clusters')} value={overview.data.clusters} />
                <Figure label={t('admin.overview.schools')} value={overview.data.schools} />
              </dl>
            </section>
            <section aria-labelledby="overview-people" className="space-y-3">
              <h2 id="overview-people" className="font-semibold text-fg">
                {t('admin.overview.people')}
              </h2>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Figure label={t('roles.crp')} value={overview.data.staff.crp ?? 0} />
                <Figure label={t('roles.teacher')} value={overview.data.staff.teacher ?? 0} />
                <Figure
                  label={t('admin.overview.officers')}
                  value={
                    (overview.data.staff.block_officer ?? 0) +
                    (overview.data.staff.district_officer ?? 0)
                  }
                />
                <Figure
                  label={t('roles.super_admin')}
                  value={overview.data.staff.super_admin ?? 0}
                />
                <Figure
                  label={t('admin.overview.activeStudents')}
                  value={overview.data.students.active ?? 0}
                />
                <Figure
                  label={t('admin.overview.pendingStudents')}
                  value={overview.data.students.pending ?? 0}
                />
                <Figure
                  label={t('admin.overview.familyAccounts')}
                  value={overview.data.family_accounts}
                />
              </dl>
            </section>
          </>
        ) : null}
      </QueryState>
    </div>
  );
}
