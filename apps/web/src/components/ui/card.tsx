import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentPropsWithRef<'section'>) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-surface shadow-lg shadow-black/10 backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  );
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
}

export function CardHeader({ title, description, actions, titleId }: CardHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}
