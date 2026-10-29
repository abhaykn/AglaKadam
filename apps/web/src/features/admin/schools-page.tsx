import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, School, Upload } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { fetchSchools, importSchools, updateSchool, type SchoolImportResult } from './admin-api';
import { ImportPanel, type ImportColumn } from './import-panel';
import { Pagination } from './pagination';
import { usePageInRange } from './use-page-in-range';

const SCHOOL_COLUMNS: ImportColumn[] = [
  { name: 'state_code', required: true },
  { name: 'state_name', required: true },
  { name: 'district_code', required: true },
  { name: 'district_name', required: true },
  { name: 'block_code', required: true },
  { name: 'block_name', required: true },
  { name: 'cluster_code', required: true },
  { name: 'cluster_name', required: true },
  { name: 'udise_code', required: true },
  { name: 'school_name', required: true },
  { name: 'school_name_hi', required: false },
  { name: 'village', required: false },
  { name: 'state_name_hi', required: false },
  { name: 'district_name_hi', required: false },
  { name: 'block_name_hi', required: false },
  { name: 'cluster_name_hi', required: false },
];

function ImportSummaryView({ result }: { result: SchoolImportResult }) {
  const { t } = useTranslation();
  const levels = ['states', 'districts', 'blocks', 'clusters', 'schools'] as const;
  return (
    <Alert tone="success" title={t('admin.schools.imported', { rows: result.rows })}>
      <ul className="mt-1 space-y-0.5">
        {levels.map((level) => (
          <li key={level}>
            {t(`admin.schools.levels.${level}`)}:{' '}
            {t('admin.import.createdUpdated', {
              created: result[level].created,
              updated: result[level].updated,
            })}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

interface EditableSchool {
  id: string;
  udise_code: string;
  name_en: string;
  name_hi: string | null;
  village: string | null;
  is_active: boolean;
}

function EditSchoolDialog({
  school,
  onClose,
}: {
  school: EditableSchool | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [nameEn, setNameEn] = useState(school?.name_en ?? '');
  const [nameHi, setNameHi] = useState(school?.name_hi ?? '');
  const [village, setVillage] = useState(school?.village ?? '');
  const [isActive, setActive] = useState(school?.is_active ?? true);

  const save = useMutation({
    mutationFn: () => {
      if (!school) {
        return Promise.resolve();
      }
      return updateSchool(school.id, {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        village: village.trim() || null,
        is_active: isActive,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-schools'] });
      toast.success(t('admin.saved'));
      onClose();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nameEn.trim() !== '') {
      save.mutate();
    }
  };

  return (
    <Dialog open={school !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('admin.schools.editTitle')}
        description={school ? t('home.udise', { code: school.udise_code }) : undefined}
      >
        <form onSubmit={submit} className="space-y-4">
          {save.isError ? (
            <Alert tone="danger" assertive>
              {t('admin.saveFailed')}
            </Alert>
          ) : null}
          <Field
            label={t('admin.schools.nameEn')}
            error={nameEn.trim() === '' ? t('admin.required') : undefined}
          >
            <Input
              value={nameEn}
              onChange={(event) => setNameEn(event.target.value)}
              maxLength={160}
            />
          </Field>
          <Field label={t('admin.schools.nameHi')}>
            <Input
              value={nameHi}
              onChange={(event) => setNameHi(event.target.value)}
              maxLength={160}
              lang="hi"
            />
          </Field>
          <Field label={t('admin.schools.village')}>
            <Input
              value={village}
              onChange={(event) => setVillage(event.target.value)}
              maxLength={120}
            />
          </Field>
          <label className="flex items-center gap-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setActive(event.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            {t('admin.schools.active')}
          </label>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('admin.cancel')}
            </Button>
            <Button type="submit" isLoading={save.isPending}>
              {t('admin.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SchoolsPage() {
  const { t } = useTranslation();
  const localise = useLocalisedName();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [isImportOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EditableSchool | null>(null);
  const debounced = useDebouncedValue(search);
  useDocumentTitle(t('admin.sections.schools'));

  const schools = useQuery({
    queryKey: ['admin-schools', debounced, page],
    queryFn: () => fetchSchools(debounced, page),
    placeholderData: keepPreviousData,
  });
  usePageInRange(page, setPage, schools.data, schools.error);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.sections.schools')}
        description={t('admin.schools.description')}
        actions={
          <Button onClick={() => setImportOpen(true)} leadingIcon={<Upload aria-hidden="true" />}>
            {t('admin.schools.import')}
          </Button>
        }
      />
      <Card>
        <div className="border-b border-border p-4">
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder={t('admin.schools.search')}
            aria-label={t('admin.schools.search')}
          />
        </div>
        <QueryState
          isPending={schools.isPending}
          isError={schools.isError}
          onRetry={() => void schools.refetch()}
        >
          {schools.data?.rows.length === 0 ? (
            <EmptyState
              icon={School}
              title={debounced ? t('admin.noMatches') : t('admin.schools.empty.title')}
              description={debounced ? undefined : t('admin.schools.empty.body')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="sr-only">{t('admin.sections.schools')}</caption>
                <thead className="border-b border-border text-fg-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      {t('home.columns.school')}
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      {t('admin.schools.cluster')}
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      {t('admin.schools.blockDistrict')}
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      {t('admin.status')}
                    </th>
                    <th scope="col" className="px-5 py-3">
                      <span className="sr-only">{t('admin.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schools.data?.rows.map((school) => (
                    <tr key={school.id}>
                      <th scope="row" className="px-5 py-3 font-medium text-fg">
                        {localise(school)}
                        <span className="block text-xs font-normal text-fg-muted tabular-nums">
                          {school.udise_code}
                        </span>
                      </th>
                      <td className="px-3 py-3 text-fg-muted">{localise(school.clusters)}</td>
                      <td className="px-3 py-3 text-fg-muted">
                        {localise(school.clusters.blocks)} ·{' '}
                        {localise(school.clusters.blocks.districts)}
                      </td>
                      <td className="px-3 py-3">
                        {school.is_active ? (
                          <Badge tone="success">{t('admin.active')}</Badge>
                        ) : (
                          <Badge>{t('admin.inactive')}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditing(school)}
                          aria-label={t('admin.schools.editNamed', { name: school.name_en })}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} total={schools.data?.total ?? 0} onPageChange={setPage} />
        </QueryState>
      </Card>

      <Dialog open={isImportOpen} onOpenChange={setImportOpen}>
        <DialogContent
          placement="right"
          title={t('admin.schools.import')}
          description={t('admin.schools.importDescription')}
        >
          <ImportPanel
            columns={SCHOOL_COLUMNS}
            templateFileName="schools-template.csv"
            maxRows={5000}
            onImport={async (records) => {
              const result = await importSchools(records);
              await queryClient.invalidateQueries({ queryKey: ['admin-schools'] });
              await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
              return result;
            }}
            renderResult={(result) => <ImportSummaryView result={result} />}
          />
        </DialogContent>
      </Dialog>

      {editing ? (
        <EditSchoolDialog key={editing.id} school={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
