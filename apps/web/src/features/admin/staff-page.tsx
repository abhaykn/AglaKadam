import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  KeyRound,
  MoreHorizontal,
  Phone,
  Power,
  UserPlus,
  Upload,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import type { StaffRole } from '@/features/auth/access';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { spreadsheetRow } from '@/lib/csv';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { AddStaffForm } from './add-staff-dialog';
import { fetchStaff, resetStaffPassword, setStaffActive } from './admin-api';
import { CredentialSlipsDialog, type CredentialSlip } from './credential-slips';
import { ImportPanel } from './import-panel';
import { Pagination } from './pagination';
import { ChangeMobileForm, ConfirmForm, TransferForm } from './staff-action-dialogs';
import { importStaff, STAFF_COLUMNS, type StaffImportResult } from './staff-import';
import { transferablePostings, type StaffMember } from './staff-member';
import { ASSIGNABLE_ROLES } from './staff-roles';
import { usePageInRange } from './use-page-in-range';

type DialogState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'import' }
  | { kind: 'reset'; member: StaffMember }
  | { kind: 'mobile'; member: StaffMember }
  | { kind: 'transfer'; member: StaffMember }
  | { kind: 'status'; member: StaffMember };

function StaffImportResultView({
  result,
  rowNumbers,
}: {
  result: StaffImportResult;
  rowNumbers: readonly number[];
}) {
  const { t } = useTranslation();
  const failed = result.outcomes.filter((outcome) => outcome.status === 'failed');
  const created = result.outcomes.length - failed.length;
  return (
    <div className="space-y-3">
      <Alert
        tone={failed.length === 0 ? 'success' : 'warning'}
        title={t('admin.staff.importCreated', { count: created })}
      >
        {created > 0 ? t('admin.staff.importSlipsHint') : null}
      </Alert>
      {failed.length > 0 ? (
        <Alert tone="danger" title={t('admin.staff.importFailed', { count: failed.length })}>
          <ul className="space-y-0.5">
            {failed.map((outcome) => (
              <li key={outcome.row} className="text-fg">
                {t('admin.staff.importFailedRow', {
                  row: spreadsheetRow(rowNumbers, outcome.row),
                  name: outcome.fullName,
                  reason: t(`admin.staff.creationErrors.${outcome.error}`),
                })}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

export function StaffPage() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const localise = useLocalisedName();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<StaffRole | 'all'>('all');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [slips, setSlips] = useState<CredentialSlip[]>([]);
  const debounced = useDebouncedValue(search);
  const today = todayInIndia();
  useDocumentTitle(t('admin.sections.staff'));

  const staff = useQuery({
    queryKey: ['admin-staff', debounced, role, page],
    queryFn: () => fetchStaff(debounced, role, page),
    placeholderData: keepPreviousData,
  });
  usePageInRange(page, setPage, staff.data, staff.error);

  const members: StaffMember[] = (staff.data?.rows ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    mobile: row.phone,
    isActive: row.is_active,
    assignments: row.staff_assignments.map((assignment) => {
      const scope =
        assignment.schools ?? assignment.clusters ?? assignment.blocks ?? assignment.districts;
      return {
        id: assignment.id,
        role: assignment.role,
        scopeLabel: scope ? localise(scope) : '',
        startsOn: assignment.starts_on,
        endsOn: assignment.ends_on,
      };
    }),
  }));
  const pendingPasswordChange = new Set(
    (staff.data?.rows ?? []).filter((row) => row.password_change_required).map((row) => row.id),
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
  };
  const close = () => setDialog({ kind: 'none' });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.sections.staff')}
        description={t('admin.staff.description')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setDialog({ kind: 'import' })}
              leadingIcon={<Upload aria-hidden="true" />}
            >
              {t('admin.staff.import')}
            </Button>
            <Button
              onClick={() => setDialog({ kind: 'add' })}
              leadingIcon={<UserPlus aria-hidden="true" />}
            >
              {t('admin.staff.add')}
            </Button>
          </>
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_14rem]">
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder={t('admin.staff.search')}
            aria-label={t('admin.staff.search')}
          />
          <Select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as StaffRole | 'all');
              setPage(0);
            }}
            aria-label={t('admin.staff.role')}
          >
            <option value="all">{t('admin.staff.allRoles')}</option>
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {t(`roles.${option}`)}
              </option>
            ))}
          </Select>
        </div>
        <QueryState
          isPending={staff.isPending}
          isError={staff.isError}
          onRetry={() => void staff.refetch()}
        >
          {members.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={
                debounced || role !== 'all' ? t('admin.noMatches') : t('admin.staff.empty.title')
              }
              description={debounced || role !== 'all' ? undefined : t('admin.staff.empty.body')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {members.map((member) => (
                <li key={member.id} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-medium text-fg">
                      {member.fullName}
                      {member.id === access.user_id ? (
                        <span className="ml-2 text-sm font-normal text-fg-muted">
                          ({t('admin.staff.you')})
                        </span>
                      ) : null}
                    </p>
                    {member.mobile ? (
                      <p className="text-sm text-fg-muted tabular-nums">{member.mobile}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-1.5">
                      {member.assignments.map((assignment) => (
                        <Badge
                          key={assignment.id}
                          tone={assignment.startsOn > today ? 'info' : 'brand'}
                        >
                          {t(`roles.${assignment.role}`)}
                          {assignment.scopeLabel ? ` · ${assignment.scopeLabel}` : ''}
                          {assignment.startsOn > today
                            ? ` · ${t('admin.staff.postingFrom', { date: assignment.startsOn })}`
                            : ''}
                          {assignment.endsOn
                            ? ` · ${t('admin.staff.postingUntil', { date: assignment.endsOn })}`
                            : ''}
                        </Badge>
                      ))}
                      {!member.isActive ? (
                        <Badge tone="danger">{t('admin.staff.deactivated')}</Badge>
                      ) : null}
                      {member.isActive && pendingPasswordChange.has(member.id) ? (
                        <Badge tone="warning">{t('admin.staff.awaitingFirstSignIn')}</Badge>
                      ) : null}
                    </div>
                  </div>
                  {member.id === access.user_id ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('admin.staff.actionsFor', { name: member.fullName })}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'reset', member })}>
                          <KeyRound aria-hidden="true" />
                          {t('admin.staff.resetPassword')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'mobile', member })}>
                          <Phone aria-hidden="true" />
                          {t('admin.staff.changeMobile')}
                        </DropdownMenuItem>
                        {transferablePostings(member).length > 0 ? (
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'transfer', member })}
                          >
                            <ArrowRightLeft aria-hidden="true" />
                            {t('admin.staff.transfer')}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'status', member })}>
                          <Power aria-hidden="true" />
                          {member.isActive
                            ? t('admin.staff.deactivate')
                            : t('admin.staff.reactivate')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} total={staff.data?.total ?? 0} onPageChange={setPage} />
        </QueryState>
      </Card>

      <Dialog open={dialog.kind !== 'none'} onOpenChange={(open) => !open && close()}>
        {dialog.kind === 'add' ? (
          <AddStaffForm
            onCreated={(slip) => {
              close();
              setSlips([slip]);
              void refresh();
            }}
          />
        ) : null}
        {dialog.kind === 'import' ? (
          <DialogContent
            placement="right"
            title={t('admin.staff.import')}
            description={t('admin.staff.importDescription')}
          >
            <ImportPanel
              columns={STAFF_COLUMNS}
              templateFileName="staff-template.csv"
              maxRows={1000}
              onImport={async (records) => {
                const result = await importStaff(records);
                const created = result.outcomes.flatMap((outcome): CredentialSlip[] =>
                  outcome.status === 'created'
                    ? [
                        {
                          kind: 'staff',
                          fullName: outcome.full_name,
                          mobile: outcome.mobile,
                          temporaryPassword: outcome.temporary_password,
                        },
                      ]
                    : [],
                );
                // The temporary passwords are shown only once, so the slips come first.
                if (created.length > 0) {
                  setSlips(created);
                }
                await refresh();
                return result;
              }}
              renderResult={(result, rowNumbers) => (
                <StaffImportResultView result={result} rowNumbers={rowNumbers} />
              )}
            />
          </DialogContent>
        ) : null}
        {dialog.kind === 'reset' ? (
          <ConfirmForm
            title={t('admin.staff.resetPasswordTitle')}
            body={t('admin.staff.resetPasswordBody', { name: dialog.member.fullName })}
            confirmLabel={t('admin.staff.resetPassword')}
            onCancel={close}
            onConfirm={async () => {
              const result = await resetStaffPassword(dialog.member.id);
              close();
              setSlips([
                {
                  kind: 'staff',
                  fullName: dialog.member.fullName,
                  mobile: dialog.member.mobile ?? '',
                  temporaryPassword: result.temporary_password,
                },
              ]);
              await refresh();
            }}
          />
        ) : null}
        {dialog.kind === 'mobile' ? (
          <ChangeMobileForm
            member={dialog.member}
            onDone={() => {
              close();
              toast.success(t('admin.saved'));
              void refresh();
            }}
          />
        ) : null}
        {dialog.kind === 'transfer' ? (
          <TransferForm
            member={dialog.member}
            onDone={() => {
              close();
              toast.success(t('admin.staff.transferred'));
              void refresh();
            }}
          />
        ) : null}
        {dialog.kind === 'status' ? (
          <ConfirmForm
            title={
              dialog.member.isActive
                ? t('admin.staff.deactivateTitle')
                : t('admin.staff.reactivateTitle')
            }
            body={
              dialog.member.isActive
                ? t('admin.staff.deactivateBody', { name: dialog.member.fullName })
                : t('admin.staff.reactivateBody', { name: dialog.member.fullName })
            }
            confirmLabel={
              dialog.member.isActive ? t('admin.staff.deactivate') : t('admin.staff.reactivate')
            }
            tone={dialog.member.isActive ? 'danger' : 'primary'}
            onCancel={close}
            onConfirm={async () => {
              await setStaffActive(dialog.member.id, !dialog.member.isActive);
              close();
              toast.success(t('admin.saved'));
              await refresh();
            }}
          />
        ) : null}
      </Dialog>

      <CredentialSlipsDialog slips={slips} onClose={() => setSlips([])} />
    </div>
  );
}
