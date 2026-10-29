import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const alertVariants = cva('flex gap-3 rounded-xl border px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-soft text-fg',
      success: 'border-success/30 bg-success-soft text-fg',
      warning: 'border-warning/30 bg-warning-soft text-fg',
      danger: 'border-danger/30 bg-danger-soft text-fg',
    },
  },
  defaultVariants: { tone: 'info' },
});

const icons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

const iconColours = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

interface AlertProps extends VariantProps<typeof alertVariants> {
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Announce immediately (for errors that follow a user action). */
  assertive?: boolean;
}

export function Alert({ tone, title, children, className, assertive = false }: AlertProps) {
  const resolvedTone = tone ?? 'info';
  const Icon = icons[resolvedTone];
  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={cn(alertVariants({ tone: resolvedTone }), className)}
    >
      <Icon
        className={cn('mt-0.5 size-5 shrink-0', iconColours[resolvedTone])}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-fg-muted">{children}</div> : null}
      </div>
    </div>
  );
}
