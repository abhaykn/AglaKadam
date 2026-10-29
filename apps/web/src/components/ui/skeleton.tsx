import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

/** Placeholder block shown while content loads, in place of spinners. */
export function Skeleton({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('skeleton-shimmer rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}
