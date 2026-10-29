import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * The face of Disha: a compass star over the same sky blue as the product's mark. The name means
 * "direction". Colours are fixed so it stays recognisable on every surface.
 */
export function DishaAvatar({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('size-10 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7CC8F2" />
          <stop offset="1" stopColor="#2D86B4" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${gradient})`} />
      <circle cx="20" cy="20" r="14.5" fill="none" stroke="#04293F" strokeOpacity="0.28" />
      <path d="M20 7 L23.4 20 L20 33 L16.6 20Z" fill="#04293F" />
      <path d="M7 20 L20 16.6 L33 20 L20 23.4Z" fill="#04293F" fillOpacity="0.55" />
      <circle cx="20" cy="20" r="3" fill="#FFD27A" />
    </svg>
  );
}
