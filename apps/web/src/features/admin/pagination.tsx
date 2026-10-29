import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { PAGE_SIZE } from './admin-api';

interface PaginationProps {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, total, onPageChange }: PaginationProps) {
  const { t, i18n } = useTranslation();
  if (total <= PAGE_SIZE) {
    return null;
  }
  const number = new Intl.NumberFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN');
  const first = page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  const lastPage = Math.ceil(total / PAGE_SIZE) - 1;

  return (
    <nav
      aria-label={t('admin.pagination.label')}
      className="flex items-center justify-between gap-4 border-t border-border px-5 py-3"
    >
      <p className="text-sm text-fg-muted" aria-live="polite">
        {t('admin.pagination.range', {
          first: number.format(first),
          last: number.format(last),
          total: number.format(total),
        })}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          leadingIcon={<ChevronLeft aria-hidden="true" />}
        >
          {t('admin.pagination.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= lastPage}
        >
          {t('admin.pagination.next')}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
