import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SectionHeadingProps {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}

export function SectionHeading({ id, title, subtitle, eyebrow, className }: SectionHeadingProps) {
  return (
    <div className={cn('max-w-2xl space-y-4', className)}>
      {eyebrow ? <p className="text-sm font-medium tracking-wide text-primary">{eyebrow}</p> : null}
      <h2
        id={id}
        className="text-[2.75rem] leading-[0.98] font-normal tracking-[-0.03em] text-balance text-fg sm:text-6xl"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p className="text-base leading-relaxed text-fg-muted sm:text-lg">{subtitle}</p>
      ) : null}
    </div>
  );
}
