import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, KeyRound, X } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { passwordIssues, type PasswordIssue } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { sessionStore } from '@/features/auth/session';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';
import { useDocumentTitle } from '@/lib/use-document-title';
import { changePassword, PasswordChangeError } from './change-password';

const RULES: readonly PasswordIssue[] = [
  'too_short',
  'needs_letter',
  'needs_digit',
  'contains_mobile',
];

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const email = useStore(sessionStore, (state) =>
    state.status === 'signed-in' ? state.email : null,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useDocumentTitle(t('password.title'));

  const isFirstChange = access.password_change_required;
  const [needsCurrent, setNeedsCurrent] = useState(!isFirstChange);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const issues = passwordIssues(next, access.phone);
  // The length limit is rarely reached, so it is listed only when the new password breaks it.
  const rules: readonly PasswordIssue[] = issues.includes('too_long')
    ? [...RULES, 'too_long']
    : RULES;
  const confirmationMismatch = confirmation.length > 0 && confirmation !== next;

  if (access.account_kind !== 'staff') {
    return (
      <div className="container-page py-8">
        <Alert tone="info">{t('password.familyNotApplicable')}</Alert>
      </div>
    );
  }

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (issues.length > 0) {
      setError(t('password.errors.rulesNotMet'));
      return;
    }
    if (next !== confirmation) {
      setError(t('password.errors.mismatch'));
      return;
    }
    if (needsCurrent && current === '') {
      setError(t('password.errors.currentRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({
        email,
        currentPassword: needsCurrent ? current : null,
        newPassword: next,
      });
      await queryClient.invalidateQueries({ queryKey: ['access'] });
      toast.success(t('password.changed'));
      await navigate({ to: '/app', replace: true });
    } catch (failure) {
      if (!(failure instanceof PasswordChangeError)) {
        setError(t('auth.errors.unexpected'));
        return;
      }
      switch (failure.failure.reason) {
        case 'reauthentication_required':
          setNeedsCurrent(true);
          setError(t('password.errors.reauthenticate'));
          break;
        case 'current_password_incorrect':
          setError(t('password.errors.currentIncorrect'));
          break;
        case 'weak_password':
          setError(t('password.errors.rulesNotMet'));
          break;
        case 'network':
          setError(t('auth.errors.network'));
          break;
        case 'unexpected':
          setError(t('auth.errors.unexpected'));
          break;
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container-page max-w-xl py-8">
      <Card>
        <CardHeader
          title={isFirstChange ? t('password.firstTitle') : t('password.title')}
          description={isFirstChange ? t('password.firstDescription') : t('password.description')}
        />
        <CardBody>
          <form onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
            {error ? (
              <Alert tone="danger" assertive>
                {error}
              </Alert>
            ) : null}
            {needsCurrent ? (
              <Field label={t('password.current')}>
                <PasswordInput
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  disabled={isSubmitting}
                />
              </Field>
            ) : null}
            <Field label={t('password.new')}>
              <PasswordInput
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                disabled={isSubmitting}
              />
            </Field>
            <ul className="space-y-1.5 text-sm" aria-label={t('password.rulesLabel')}>
              {rules
                .filter((rule) => rule !== 'contains_mobile' || access.phone)
                .map((rule) => {
                  const met = next.length > 0 && !issues.includes(rule);
                  return (
                    <li
                      key={rule}
                      className={cn(
                        'flex items-center gap-2',
                        met ? 'text-success' : 'text-fg-muted',
                      )}
                    >
                      {met ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <X className="size-4" aria-hidden="true" />
                      )}
                      <span>{t(`password.rules.${rule}`)}</span>
                      <span className="sr-only">
                        {met ? t('password.ruleMet') : t('password.ruleNotMet')}
                      </span>
                    </li>
                  );
                })}
            </ul>
            <Field
              label={t('password.confirm')}
              error={confirmationMismatch ? t('password.errors.mismatch') : undefined}
            >
              <PasswordInput
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={isSubmitting}
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto"
              isLoading={isSubmitting}
              leadingIcon={<KeyRound aria-hidden="true" />}
            >
              {t('password.submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
