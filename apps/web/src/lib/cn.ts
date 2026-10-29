import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Semantic colour names declared in `styles/index.css`. Registering them lets tailwind-merge
 * resolve conflicts such as `text-fg` versus `text-sm` correctly.
 */
const semanticColors = [
  'canvas',
  'surface',
  'surface-muted',
  'surface-sunken',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'primary',
  'primary-hover',
  'primary-fg',
  'primary-soft',
  'primary-soft-fg',
  'accent',
  'accent-soft',
  'accent-soft-fg',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
  'ring',
  'header',
];

const mergeClasses = extendTailwindMerge({
  extend: {
    theme: {
      color: semanticColors,
    },
  },
});

/** Joins conditional class names and removes conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return mergeClasses(clsx(inputs));
}
