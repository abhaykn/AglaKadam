import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { fetchAuditEvents } from './admin-api';
import { Pagination } from './pagination';
import { usePageInRange } from './use-page-in-range';

const AUDITED_TABLES = [
  'profiles',
  'staff_assignments',
  'schools',
  'clusters',
  'blocks',
  'districts',
  'states',
  'academic_years',
  'class_sections',
  'class_teachers',
  'students',
  'student_contacts',
  'enrolments',
  'guardian_consents',
] as const;

const OPERATIONS = ['INSERT', 'UPDATE', 'DELETE'] as const;
type Operation = (typeof OPERATIONS)[number];

function isOperation(value: string): value is Operation {
  return (OPERATIONS as readonly string[]).includes(value);
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function Changes({ operation, changes }: { operation: string; changes: unknown }) {
  const { t } = useTranslation();
  if (typeof changes !== 'object' || changes === null) {
    return null;
  }
  const entries = Object.entries(changes as Record<string, unknown>);
  if (operation === 'UPDATE') {
    return (
      <ul className="mt-2 space-y-1 text-sm">
        {entries.map(([field, change]) => {
          const { old: before, new: after } = (change ?? {}) as { old?: unknown; new?: unknown };
          return (
            <li key={field} className="break-words">
              <code className="text-xs text-fg">{field}</code>
              <span className="text-fg-muted">
                {': '}
                {t('admin.audit.changedFromTo', {
                  from: describeValue(before),
                  to: describeValue(after),
                })}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-fg-muted">{t('admin.audit.showRecord')}</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {entries.map(([field, value]) => (
          <div key={field} className="contents">
            <dt>
              <code className="text-xs text-fg">{field}</code>
            </dt>
            <dd className="break-words text-fg-muted">{describeValue(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [table, setTable] = useState<string>('all');
  const [page, setPage] = useState(0);
  useDocumentTitle(t('admin.sections.audit'));

  const events = useQuery({
    queryKey: ['audit-events', table, page],
    queryFn: () => fetchAuditEvents(table, page),
    placeholderData: keepPreviousData,
  });
  usePageInRange(page, setPage, events.data, events.error);
  const time = new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.sections.audit')} description={t('admin.audit.description')} />
      <Card>
        <div className="border-b border-border p-4">
          <Select
            value={table}
            onChange={(event) => {
              setTable(event.target.value);
              setPage(0);
            }}
            aria-label={t('admin.audit.filter')}
            className="sm:w-72"
          >
            <option value="all">{t('admin.audit.allRecords')}</option>
            {AUDITED_TABLES.map((name) => (
              <option key={name} value={name}>
                {t(`admin.audit.tables.${name}`)}
              </option>
            ))}
          </Select>
        </div>
        <QueryState
          isPending={events.isPending}
          isError={events.isError}
          onRetry={() => void events.refetch()}
        >
          {events.data?.rows.length === 0 ? (
            <EmptyState icon={ScrollText} title={t('admin.audit.empty')} />
          ) : (
            <ul className="divide-y divide-border">
              {events.data?.rows.map((event) => (
                <li key={event.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge
                      tone={
                        event.operation === 'DELETE'
                          ? 'danger'
                          : event.operation === 'INSERT'
                            ? 'success'
                            : 'info'
                      }
                    >
                      {isOperation(event.operation)
                        ? t(`admin.audit.operations.${event.operation}`)
                        : event.operation}
                    </Badge>
                    <span className="font-medium text-fg">
                      {(AUDITED_TABLES as readonly string[]).includes(event.table_name)
                        ? t(
                            `admin.audit.tables.${event.table_name as (typeof AUDITED_TABLES)[number]}`,
                          )
                        : event.table_name}
                    </span>
                    <span className="text-fg-muted">
                      {time.format(new Date(event.occurred_at))} ·{' '}
                      {event.actor_name ??
                        (event.actor_role === 'service_role'
                          ? t('admin.audit.service')
                          : t('admin.audit.system'))}
                    </span>
                  </div>
                  <Changes operation={event.operation} changes={event.changes} />
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} total={events.data?.total ?? 0} onPageChange={setPage} />
        </QueryState>
      </Card>
    </div>
  );
}
