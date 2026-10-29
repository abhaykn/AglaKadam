import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { KeyRound, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { useSignOut } from '@/features/app-shell/use-sign-out';
import { NotificationsCard } from '@/features/notifications/notifications-card';
import { setLanguage, type Language } from '@/features/preferences/preferences';
import { useLocalisedName } from '@/lib/use-localised-name';
import { getSupabase } from '@/lib/supabase';
import { useDocumentTitle } from '@/lib/use-document-title';

export function AccountPage() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const queryClient = useQueryClient();
  const handleSignOut = useSignOut();
  const localise = useLocalisedName();
  useDocumentTitle(t('account.title'));

  const savePreference = useMutation({
    mutationFn: async (language: Language) => {
      const { error } = await getSupabase()
        .from('profiles')
        .update({ preferred_language: language })
        .eq('id', access.user_id);
      if (error) {
        throw error;
      }
      return language;
    },
    onSuccess: async (language) => {
      setLanguage(language);
      await queryClient.invalidateQueries({ queryKey: ['access'] });
      toast.success(t('account.languageSaved'));
    },
    onError: () => {
      toast.error(t('account.languageNotSaved'));
    },
  });

  return (
    <div className="container-page max-w-2xl space-y-6 py-8">
      <h1 className="text-2xl font-bold text-fg">{t('account.title')}</h1>

      <Card>
        <CardHeader title={t('account.profile')} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-fg-muted">{t('account.name')}</dt>
              <dd className="font-medium text-fg">{access.full_name}</dd>
            </div>
            {access.phone ? (
              <div>
                <dt className="text-sm text-fg-muted">{t('account.mobile')}</dt>
                <dd className="font-medium text-fg tabular-nums">{access.phone}</dd>
              </div>
            ) : null}
            {access.student ? (
              <div>
                <dt className="text-sm text-fg-muted">{t('account.learnerCode')}</dt>
                <dd className="font-medium text-fg tabular-nums">{access.student.student_code}</dd>
              </div>
            ) : null}
          </dl>
          {access.assignments.length > 0 ? (
            <div className="mt-5">
              <p className="text-sm text-fg-muted">{t('account.roles')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {access.assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Badge tone="brand">
                      {t(`roles.${assignment.role}`)}
                      {assignment.scope ? ` · ${localise(assignment.scope)}` : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('account.preferences')} />
        <CardBody>
          <Field label={t('account.preferredLanguage')} hint={t('account.preferredLanguageHint')}>
            <Select
              value={access.preferred_language}
              disabled={savePreference.isPending}
              onChange={(event) => savePreference.mutate(event.target.value as Language)}
            >
              <option value="hi">हिन्दी</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <NotificationsCard />

      <div className="flex flex-wrap gap-3">
        {access.account_kind === 'staff' ? (
          <Button asChild variant="secondary">
            <Link to="/app/change-password">
              <KeyRound aria-hidden="true" />
              {t('app.changePassword')}
            </Link>
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => void handleSignOut()}
          leadingIcon={<LogOut aria-hidden="true" />}
        >
          {t('app.signOut')}
        </Button>
      </div>
    </div>
  );
}
