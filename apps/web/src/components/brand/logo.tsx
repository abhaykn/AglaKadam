import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface LogoMarkProps {
  className?: string;
  title?: string;
}

/**
 * Brand mark: a rising set of steps with a learner moving up to the next one.
 * Colours are fixed so the mark stays recognisable on every surface.
 */
export function LogoMark({ className, title }: LogoMarkProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('size-9 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7CC8F2" />
          <stop offset="1" stopColor="#2D86B4" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill={`url(#${gradientId})`} />
      <path
        d="M9 29V23.5H16V17.5H23V11.5H31V29Z"
        fill="#04293F"
        stroke="#04293F"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="18.9" cy="12.2" r="2.6" fill="#FFD27A" />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  /** False where space is short: below 360 pixels only the mark shows (the link names the app). */
  wordmarkOnNarrow?: boolean;
}

/** Mark plus wordmark; the wordmark follows the active interface language. */
export function Logo({ className, wordmarkOnNarrow = true }: LogoProps) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span
        className={cn(
          'text-[1.0625rem] leading-none font-semibold tracking-tight text-fg',
          !wordmarkOnNarrow && 'hidden min-[360px]:inline',
        )}
      >
        {t('common.appName')}
      </span>
    </span>
  );
}
