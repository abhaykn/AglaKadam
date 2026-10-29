import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { isStaleCodeError, updateStore } from '@/features/pwa/service-worker';
import { useStore } from '@/lib/store';
import { useDocumentTitle } from '@/lib/use-document-title';
import { StatusPage } from './status-page';

/**
 * Last-resort boundary. It deliberately avoids the full page frame so that a failure inside the
 * header or footer cannot prevent the recovery screen from rendering.
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const stale = useStore(updateStore) === 'reload-needed' || isStaleCodeError(error);
  useDocumentTitle(t('errorBoundary.title'));

  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = (): void => {
    reset();
    void router.invalidate();
  };

  return (
    <main id="main-content" className="min-h-dvh">
      <div className="container-page pt-6">
        <Link to="/" aria-label={t('common.homeLink')} className="inline-flex rounded-lg">
          <LogoMark />
        </Link>
      </div>
      <StatusPage
        icon={TriangleAlert}
        title={t('errorBoundary.title')}
        body={stale ? t('errorBoundary.staleBody') : t('errorBoundary.body')}
        actions={
          <>
            {stale ? (
              <Button
                onClick={() => window.location.reload()}
                leadingIcon={<RefreshCw aria-hidden="true" />}
              >
                {t('common.reload')}
              </Button>
            ) : (
              <Button onClick={retry} leadingIcon={<RotateCcw aria-hidden="true" />}>
                {t('errorBoundary.retry')}
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link to="/">{t('notFound.backHome')}</Link>
            </Button>
          </>
        }
      />
    </main>
  );
}
