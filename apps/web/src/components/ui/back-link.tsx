import { createLink } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

function BackAnchor({ className, children, ...props }: ComponentPropsWithRef<'a'>) {
  return (
    <a
      className={cn(
        'inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline',
        className,
      )}
      {...props}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </a>
  );
}

/**
 * The link at the top of a page that leads back to the page it came from. It takes the same
 * props as the router's `Link` (`to`, `params`, `search`), so every page links back the same way.
 */
export const BackLink = createLink(BackAnchor);
