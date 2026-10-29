import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { normaliseMobile, todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import type { StaffRole } from '@/features/auth/access';
import { useActionErrorMessage } from './action-errors';
import { changeStaffMobile, transferAssignment, type ScopeOption } from './admin-api';
import { ScopePicker } from './scope-picker';
import { transferablePostings, type StaffMember } from './staff-member';
import { ASSIGNABLE_ROLES } from './staff-roles';

export function ChangeMobileForm({ member, onDone }: { member: StaffMember; onDone: () => void }) {
  const { t } = useTranslation();
  const describe = useActionErrorMessage();
  const [mobile, setMobile] = useState(member.mobile ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalised = normaliseMobile(mobile);
    if (!normalised) {
      setError(t('auth.errors.invalidMobile'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changeStaffMobile(member.id, normalised);
      onDone();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent title={t('admin.staff.changeMobileTitle')} description={member.fullName}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {error ? (
          <Alert tone="danger" assertive>
            {error}
          </Alert>
        ) : null}
        <Field label={t('admin.staff.mobile')} hint={t('admin.staff.changeMobileHint')}>
          <Input
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
            inputMode="tel"
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" isLoading={isSubmitting}>
            {t('admin.save')}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

export function TransferForm({ member, onDone }: { member: StaffMember; onDone: () => void }) {
  const { t } = useTranslation();
  const describe = useActionErrorMessage();
  const postings = transferablePostings(member);
  const [assignmentId, setAssignmentId] = useState(postings[0]?.id ?? '');
  const [role, setRole] = useState<StaffRole>(postings[0]?.role ?? 'teacher');
  const [scope, setScope] = useState<ScopeOption | null>(null);
  // A posting that has not started yet can only be transferred from its own start date.
  const earliestFor = (id: string) => {
    const startsOn = postings.find((posting) => posting.id === id)?.startsOn ?? '';
    const today = todayInIndia();
    return startsOn > today ? startsOn : today;
  };
  const [effectiveOn, setEffectiveOn] = useState(() => earliestFor(postings[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const startsOn = postings.find((posting) => posting.id === assignmentId)?.startsOn ?? '';

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (role !== 'super_admin' && !scope) {
      setError(t('admin.staff.scopeRequired'));
      return;
    }
    if (effectiveOn === '') {
      setError(t('admin.staff.effectiveOnRequired'));
      return;
    }
    if (effectiveOn < startsOn) {
      setError(t('admin.staff.effectiveOnTooEarly', { date: startsOn }));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await transferAssignment({ assignmentId, role, scopeId: scope?.id ?? null, effectiveOn });
      onDone();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent
      placement="right"
      title={t('admin.staff.transferTitle')}
      description={member.fullName}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {error ? (
          <Alert tone="danger" assertive>
            {error}
          </Alert>
        ) : null}
        {postings.length > 1 ? (
          <Field label={t('admin.staff.currentPosting')}>
            <Select
              value={assignmentId}
              onChange={(event) => {
                setAssignmentId(event.target.value);
                setEffectiveOn(earliestFor(event.target.value));
              }}
            >
              {postings.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {t(`roles.${assignment.role}`)} · {assignment.scopeLabel}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-fg-muted">
            {t('admin.staff.currentPostingIs', {
              posting: postings[0]
                ? `${t(`roles.${postings[0].role}`)} · ${postings[0].scopeLabel}`
                : '',
            })}
          </p>
        )}
        <Field label={t('admin.staff.newRole')}>
          <Select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as StaffRole);
              setScope(null);
            }}
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {t(`roles.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-fg">{t(`admin.staff.scopeLabel.${role}`)}</p>
          <ScopePicker role={role} value={scope} onChange={setScope} disabled={isSubmitting} />
        </div>
        <Field label={t('admin.staff.effectiveOn')} hint={t('admin.staff.effectiveOnHint')}>
          <Input
            type="date"
            value={effectiveOn}
            min={startsOn || undefined}
            onChange={(event) => setEffectiveOn(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {t('admin.staff.transfer')}
        </Button>
      </form>
    </DialogContent>
  );
}

interface ConfirmFormProps {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** Confirmation for an action that cannot simply be undone, with its own error reporting. */
export function ConfirmForm({
  title,
  body,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmFormProps) {
  const { t } = useTranslation();
  const describe = useActionErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setWorking] = useState(false);

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <DialogContent title={title} description={body}>
      <div className="space-y-4">
        {error ? (
          <Alert tone="danger" assertive>
            {error}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={isWorking}>
            {t('admin.cancel')}
          </Button>
          <Button variant={tone} onClick={() => void confirm()} isLoading={isWorking}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
