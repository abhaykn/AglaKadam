import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '@/components/layout/public-layout';
import { Button } from '@/components/ui/button';
import { NightReadingScene } from '@/features/landing/illustrations';
import { useDocumentTitle } from '@/lib/use-document-title';

export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('notFound.title'));

  return (
    <PublicLayout>
      <div className="container-page flex min-h-[70dvh] flex-col items-center justify-center py-12 text-center">
        <div className="liquid-glass relative h-52 w-full max-w-3xl overflow-hidden rounded-3xl sm:h-72">
          <NightReadingScene className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-b from-[hsl(201_100%_9%/0.7)] to-transparent" />
          <p
            aria-hidden="true"
            className="relative pt-6 text-7xl leading-none tracking-[-0.03em] text-white/90 sm:pt-8 sm:text-8xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            404
          </p>
        </div>
        <h1 className="mt-10 text-4xl text-fg sm:text-5xl">{t('notFound.title')}</h1>
        <p className="mt-4 max-w-md text-fg-muted">{t('notFound.body')}</p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link to="/">{t('notFound.backHome')}</Link>
          </Button>
        </div>
      </div>
    </PublicLayout>
  );
}
