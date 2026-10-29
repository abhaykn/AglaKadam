import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { normaliseMobile } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import type { StaffRole } from '@/features/auth/access';
import { FunctionCallError } from '@/lib/functions';
import { createStaff, type ScopeOption } from './admin-api';
import type { CredentialSlip } from './credential-slips';
import { ScopePicker } from './scope-picker';
import { ASSIGNABLE_ROLES } from './staff-roles';

interface AddStaffFormProps {
  onCreated: (slip: CredentialSlip) => void;
}

/** Form for a single staff account; the temporary password is handed back as a printable slip. */
export function AddStaffForm({ onCreated }: AddStaffFormProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<StaffRole>('teacher');
  const [scope, setScope] = useState<ScopeOption | null>(null);
  const [language, setLanguage] = useState<'hi' | 'en'>('hi');
  const [startsOn, setStartsOn] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'fullName' | 'mobile' | 'scope', string>>>(
    {},
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const normalisedMobile = normaliseMobile(mobile);
    const nextErrors: typeof errors = {};
    if (fullName.trim() === '') {
      nextErrors.fullName = t('admin.required');
    }
    if (!normalisedMobile) {
      nextErrors.mobile = t('auth.errors.invalidMobile');
    }
    if (role !== 'super_admin' && !scope) {
      nextErrors.scope = t('admin.staff.scopeRequired');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !normalisedMobile) {
      return;
    }

    setSubmitting(true);
    try {
      const [outcome] = await createStaff([
        {
          full_name: fullName.trim(),
          mobile: normalisedMobile,
          role,
          scope_id: role === 'super_admin' ? null : (scope?.id ?? null),
          preferred_language: language,
          ...(startsOn ? { starts_on: startsOn } : {}),
        },
      ]);
      if (outcome?.status === 'created') {
        onCreated({
          kind: 'staff',
          fullName: outcome.full_name,
          mobile: outcome.mobile,
          temporaryPassword: outcome.temporary_password,
        });
      } else {
        setFailure(t(`admin.staff.creationErrors.${outcome?.error ?? 'rejected'}`));
      }
    } catch (error) {
      setFailure(
        error instanceof FunctionCallError && error.code === 'network'
          ? t('auth.errors.network')
          : t('admin.saveFailed'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent
      placement="right"
      title={t('admin.staff.addTitle')}
      description={t('admin.staff.addDescription')}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {failure ? (
          <Alert tone="danger" assertive>
            {failure}
          </Alert>
        ) : null}
        <Field label={t('admin.staff.fullName')} error={errors.fullName}>
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
        <Field
          label={t('admin.staff.mobile')}
          hint={t('admin.staff.mobileHint')}
          error={errors.mobile}
        >
          <Input
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
            inputMode="tel"
            autoComplete="off"
          />
        </Field>
        <Field label={t('admin.staff.role')}>
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
          {errors.scope ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.scope}
            </p>
          ) : null}
        </div>
        <Field label={t('account.preferredLanguage')}>
          <Select
            value={language}
            onChange={(event) => setLanguage(event.target.value as 'hi' | 'en')}
          >
            <option value="hi">हिन्दी</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label={t('admin.staff.startsOn')} hint={t('admin.staff.startsOnHint')}>
          <Input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {t('admin.staff.create')}
        </Button>
      </form>
    </DialogContent>
  );
}
