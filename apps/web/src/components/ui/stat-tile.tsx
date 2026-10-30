import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface StatTileProps {
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  className?: string;
}

/**
 * One figure with its name and a mark, for a row of totals. It is a term and its description, so
 * it belongs inside a `<dl>`.
 */
export function StatTile({ icon: Icon, label, value, className }: StatTileProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-xl border border-border bg-surface-muted p-4',
        className,
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-fg">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="truncate text-sm text-fg-muted">{label}</dt>
        <dd className="text-2xl leading-tight font-bold text-fg tabular-nums">{value}</dd>
      </div>
    </div>
  );
}
