import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('drops falsy values', () => {
    expect(cn('px-2', false, null, undefined, 'py-1')).toBe('px-2 py-1');
  });

  it('keeps the last of two conflicting semantic colours', () => {
    expect(cn('bg-primary', 'bg-surface')).toBe('bg-surface');
  });

  it('does not treat a text colour and a text size as a conflict', () => {
    expect(cn('text-fg', 'text-sm')).toBe('text-fg text-sm');
  });
});
