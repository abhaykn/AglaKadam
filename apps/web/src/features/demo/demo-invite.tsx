import { Link } from '@tanstack/react-router';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * The first thing a reviewer sees on the landing page: that the whole application can be tried in
 * a district of their own, after choosing a role, without an account.
 */
export function DemoInvite() {
  const { t } = useTranslation();
  return (
    <div className="border-b border-primary/20 bg-primary-soft">
      <div className="container-page flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
        <p className="flex items-start gap-2 text-sm text-primary-soft-fg">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t('demo.invite.title')}</span> {t('demo.invite.body')}
          </span>
        </p>
        <Button asChild size="sm" className="shrink-0 sm:ml-auto">
          <Link to="/demo">
            {t('demo.invite.action')}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
