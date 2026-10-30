import { cn } from '@/lib/cn';

interface MeterProps {
  /** A share from 0 to 100. */
  value: number;
  /** The figure as it is written beside the bar. */
  label: string;
  className?: string;
}

/** A figure with a thin bar that shows its share of the whole, for a column of percentages. */
export function Meter({ value, label, className }: MeterProps) {
  const share = Math.min(100, Math.max(0, value));
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken"
      >
        <span
          className="block h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
          style={{ width: `${String(share)}%` }}
        />
      </span>
      <span className="min-w-10 tabular-nums">{label}</span>
    </span>
  );
}
