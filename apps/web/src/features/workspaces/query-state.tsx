import { CircleAlert, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface QueryStateProps {
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Number of placeholder rows while loading. */
  rows?: number;
  children: ReactNode;
}

/** Loading, failure and success states of a data request, consistently across the application. */
export function QueryState({ isPending, isError, onRetry, rows = 3, children }: QueryStateProps) {
  const { t } = useTranslation();
  if (isPending) {
    return (
      <div className="space-y-3 p-5" aria-busy="true" aria-label={t('app.loading')}>
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        icon={CircleAlert}
        title={t('app.loadError.title')}
        description={t('app.loadError.body')}
        action={
          <Button
            variant="secondary"
            onClick={onRetry}
            leadingIcon={<RotateCcw aria-hidden="true" />}
          >
            {t('errorBoundary.retry')}
          </Button>
        }
      />
    );
  }
  return children;
}
