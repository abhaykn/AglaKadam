import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, MoreHorizontal, Ticket, TicketX, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  fetchAcademicYears,
  fetchStudents,
  importStudents,
  issueFamilyLogin,
  revokeFamilyLogin,
  type ScopeOption,
  type StudentImportResult,
} from './admin-api';
import { useActionErrorMessage } from './action-errors';
import { CredentialSlipsDialog, type CredentialSlip } from './credential-slips';
import { ImportPanel, type ImportColumn } from './import-panel';
import { Pagination } from './pagination';
import { ScopePicker } from './scope-picker';
import { ConfirmForm } from './staff-action-dialogs';
import { usePageInRange } from './use-page-in-range';

type StudentStatus = 'pending' | 'active' | 'left';

function statusOf(value: string): StudentStatus {
  return value === 'pending' || value === 'left' ? value : 'active';
}

const STUDENT_COLUMNS: ImportColumn[] = [
  { name: 'full_name', required: true },
  { name: 'gender', required: true },
  { name: 'grade', required: true },
  { name: 'section', required: false },
  { name: 'admission_number', required: false },
  { name: 'date_of_birth', required: false },
  { name: 'has_special_needs', required: false },
];

interface StudentSummary {
  id: string;
  fullName: string;
}

function ImportStudentsPanel({
  school,
  onImported,
}: {
  school: ScopeOption;
  onImported: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const years = useQuery({ queryKey: ['academic-years'], queryFn: fetchAcademicYears });
  const [yearId, setYearId] = useState<string>('');
  const today = todayInIndia();
  const runningYear = years.data?.find((year) => year.starts_on <= today && today <= year.ends_on);
  const selectedYear = yearId !== '' ? yearId : (runningYear?.id ?? years.data?.[0]?.id ?? '');

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">
        {t('admin.students.importInto', { school: school.name })}
      </p>
      {years.data?.length === 0 ? (
        <Alert tone="warning">{t('admin.students.noAcademicYear')}</Alert>
      ) : (
        <Field label={t('admin.students.academicYear')}>
          <Select value={selectedYear} onChange={(event) => setYearId(event.target.value)}>
            {(years.data ?? []).map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ImportPanel
        columns={STUDENT_COLUMNS}
        templateFileName="students-template.csv"
        maxRows={2000}
        disabled={!selectedYear}
        onImport={async (records) => {
          const result = await importStudents(school.id, selectedYear, records);
          await onImported();
          return result;
        }}
        renderResult={(result: StudentImportResult) => (
          <Alert tone="success" title={t('admin.students.imported', { count: result.created })}>
            {result.skipped_existing > 0 ? (
              <p>{t('admin.students.skipped', { count: result.skipped_existing })}</p>
            ) : null}
            {result.classes_created > 0 ? (
              <p>{t('admin.students.classesCreated', { count: result.classes_created })}</p>
            ) : null}
          </Alert>
        )}
      />
    </div>
  );
}

export function StudentsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [school, setSchool] = useState<ScopeOption | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [isImportOpen, setImportOpen] = useState(false);
  const [revoking, setRevoking] = useState<StudentSummary | null>(null);
  // A new PIN stops the family's current one, so it is confirmed first.
  const [reissuing, setReissuing] = useState<StudentSummary | null>(null);
  // A second tap while a slip is being issued must not issue two PINs, only the last one working.
  const [issuing, setIssuing] = useState(false);
  const [slips, setSlips] = useState<CredentialSlip[]>([]);
  const [issueError, setIssueError] = useState<string | null>(null);
  const describeError = useActionErrorMessage();
  const debounced = useDebouncedValue(search);
  useDocumentTitle(t('admin.sections.students'));

  const students = useQuery({
    queryKey: ['admin-students', school?.id, debounced, page],
    queryFn: () => fetchStudents(school?.id ?? '', debounced, page),
    enabled: school !== null,
    // Keep the rows on screen while paging or searching within a school, but never show one
    // school's learners under another.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === school?.id ? previous : undefined,
  });
  usePageInRange(page, setPage, students.data, students.error);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-students'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
  };

  const showSlip = async (student: StudentSummary) => {
    const result = await issueFamilyLogin(student.id);
    setSlips([
      {
        kind: 'family',
        fullName: result.full_name,
        learnerCode: result.learner_code,
        pin: result.pin,
      },
    ]);
    await refresh();
  };

  const issue = async (student: StudentSummary) => {
    if (issuing) {
      return;
    }
    setIssuing(true);
    setIssueError(null);
    try {
      await showSlip(student);
    } catch (error) {
      setIssueError(
        describeError(error, t('admin.students.issueFailed', { name: student.fullName })),
      );
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.sections.students')}
        description={t('admin.students.description')}
        actions={
          school ? (
            <Button onClick={() => setImportOpen(true)} leadingIcon={<Upload aria-hidden="true" />}>
              {t('admin.students.import')}
            </Button>
          ) : null
        }
      />
      <Card>
        <CardBody>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-fg">{t('admin.students.chooseSchool')}</p>
            <ScopePicker
              role="teacher"
              includeInactiveSchools
              value={school}
              onChange={(next) => {
                setSchool(next);
                setPage(0);
                setSearch('');
              }}
            />
          </div>
        </CardBody>
      </Card>

      {issueError ? (
        <Alert tone="danger" assertive>
          {issueError}
        </Alert>
      ) : null}

      {school ? (
        <Card>
          <div className="border-b border-border p-4">
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder={t('admin.students.search')}
              aria-label={t('admin.students.search')}
            />
          </div>
          <QueryState
            isPending={students.isPending}
            isError={students.isError}
            onRetry={() => void students.refetch()}
          >
            {students.data?.rows.length === 0 ? (
              <EmptyState
                icon={GraduationCap}
                title={debounced ? t('admin.noMatches') : t('admin.students.empty.title')}
                description={debounced ? undefined : t('admin.students.empty.body')}
              />
            ) : (
              <ul className="divide-y divide-border">
                {students.data?.rows.map((student) => {
                  const enrolment = student.enrolments[0]?.class_sections;
                  return (
                    <li
                      key={student.id}
                      className="flex items-start justify-between gap-4 px-5 py-4"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <p className="font-medium text-fg">{student.full_name}</p>
                        <p className="text-sm text-fg-muted tabular-nums">
                          {t('admin.students.learnerCode', { code: student.student_code })}
                          {student.admission_number
                            ? ` · ${t('admin.students.admission', { number: student.admission_number })}`
                            : ''}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {enrolment ? (
                            <Badge>
                              {classLabel(t, enrolment.grade, enrolment.section)} ·{' '}
                              {enrolment.academic_years.label}
                            </Badge>
                          ) : null}
                          <Badge
                            tone={
                              student.status === 'active'
                                ? 'success'
                                : student.status === 'pending'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {t(`admin.students.status.${statusOf(student.status)}`)}
                          </Badge>
                          {student.has_special_needs ? (
                            <Badge tone="info">{t('admin.students.specialNeeds')}</Badge>
                          ) : null}
                          {student.family_sign_in_active ? (
                            <Badge tone="brand">{t('admin.students.familyAccount')}</Badge>
                          ) : null}
                        </div>
                      </div>
                      {student.status === 'active' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('admin.staff.actionsFor', { name: student.full_name })}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              disabled={issuing}
                              onSelect={() => {
                                const chosen = { id: student.id, fullName: student.full_name };
                                if (student.family_sign_in_active) {
                                  setReissuing(chosen);
                                } else {
                                  void issue(chosen);
                                }
                              }}
                            >
                              <Ticket aria-hidden="true" />
                              {student.family_sign_in_active
                                ? t('admin.students.reissueSlip')
                                : t('admin.students.issueSlip')}
                            </DropdownMenuItem>
                            {student.family_sign_in_active ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  setRevoking({ id: student.id, fullName: student.full_name })
                                }
                              >
                                <TicketX aria-hidden="true" />
                                {t('admin.students.revokeSlip')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <Pagination page={page} total={students.data?.total ?? 0} onPageChange={setPage} />
          </QueryState>
        </Card>
      ) : null}

      <Dialog open={isImportOpen && school !== null} onOpenChange={setImportOpen}>
        {school ? (
          <DialogContent
            placement="right"
            title={t('admin.students.import')}
            description={t('admin.students.importDescription')}
          >
            <ImportStudentsPanel school={school} onImported={refresh} />
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        {revoking ? (
          <ConfirmForm
            title={t('admin.students.revokeTitle')}
            body={t('admin.students.revokeBody', { name: revoking.fullName })}
            confirmLabel={t('admin.students.revokeSlip')}
            tone="danger"
            onCancel={() => setRevoking(null)}
            onConfirm={async () => {
              await revokeFamilyLogin(revoking.id);
              setRevoking(null);
              toast.success(t('admin.students.revoked'));
              await refresh();
            }}
          />
        ) : null}
      </Dialog>

      <Dialog open={reissuing !== null} onOpenChange={(open) => !open && setReissuing(null)}>
        {reissuing ? (
          <ConfirmForm
            title={t('admin.students.reissueTitle')}
            body={t('admin.students.reissueBody', { name: reissuing.fullName })}
            confirmLabel={t('admin.students.reissueSlip')}
            onCancel={() => setReissuing(null)}
            onConfirm={async () => {
              await showSlip(reissuing);
              setReissuing(null);
            }}
          />
        ) : null}
      </Dialog>

      <CredentialSlipsDialog slips={slips} onClose={() => setSlips([])} />
    </div>
  );
}
