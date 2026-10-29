import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { sessionStartingIn } from './academic-years';
import { createAcademicYear, fetchAcademicYears } from './admin-api';

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function AcademicYearsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const today = todayInIndia();
  const currentStartYear = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  const [startYear, setStartYear] = useState(String(currentStartYear));
  useDocumentTitle(t('admin.sections.academicYears'));

  const years = useQuery({ queryKey: ['academic-years'], queryFn: fetchAcademicYears });
  const create = useMutation({
    mutationFn: () => createAcademicYear(sessionStartingIn(Number(startYear))),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['academic-years'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success(t('admin.saved'));
    },
  });

  const yearValid =
    /^\d{4}$/.test(startYear) && Number(startYear) >= 2020 && Number(startYear) <= 2100;
  const preview = yearValid ? sessionStartingIn(Number(startYear)) : null;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (yearValid) {
      create.mutate();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.sections.academicYears')}
        description={t('admin.years.description')}
      />
      <Card>
        <CardHeader title={t('admin.years.addTitle')} />
        <CardBody>
          <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Field
              label={t('admin.years.startYear')}
              hint={preview ? t('admin.years.preview', { label: preview.label }) : undefined}
              error={yearValid ? undefined : t('admin.years.invalidYear')}
              className="sm:w-64"
            >
              <Input
                inputMode="numeric"
                maxLength={4}
                value={startYear}
                onChange={(event) => setStartYear(event.target.value)}
              />
            </Field>
            <Button type="submit" isLoading={create.isPending} disabled={!yearValid}>
              {t('admin.years.add')}
            </Button>
          </form>
          {create.isError ? (
            <Alert tone="danger" assertive className="mt-4">
              {t('admin.years.addFailed')}
            </Alert>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <QueryState
          isPending={years.isPending}
          isError={years.isError}
          onRetry={() => void years.refetch()}
        >
          {years.data?.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title={t('admin.years.empty.title')}
              description={t('admin.years.empty.body')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {years.data?.map((year) => {
                const isCurrent = year.starts_on <= today && today <= year.ends_on;
                return (
                  <li key={year.id} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="font-medium text-fg tabular-nums">{year.label}</p>
                      <p className="text-sm text-fg-muted">
                        {formatDate(year.starts_on, i18n.language)} –{' '}
                        {formatDate(year.ends_on, i18n.language)}
                      </p>
                    </div>
                    {isCurrent ? <Badge tone="success">{t('admin.years.current')}</Badge> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
