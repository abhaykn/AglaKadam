import { describe, expect, it } from 'vitest';
import { niceMaximum } from './scale';

describe('the top of a chart’s scale', () => {
  it('is a round number that holds the highest value', () => {
    expect(niceMaximum(31)).toBe(50);
    expect(niceMaximum(7)).toBe(10);
    expect(niceMaximum(10)).toBe(10);
    expect(niceMaximum(10.5)).toBe(20);
    expect(niceMaximum(12)).toBe(20);
    expect(niceMaximum(120)).toBe(200);
    expect(niceMaximum(0.4)).toBe(0.5);
    expect(niceMaximum(1)).toBe(1);
  });

  it('is never below the value, and falls back to 1 for nothing to show', () => {
    for (const value of [1.2, 3, 4.9, 5, 5.1, 18, 99, 100, 101, 640]) {
      expect(niceMaximum(value)).toBeGreaterThanOrEqual(value);
    }
    expect(niceMaximum(0)).toBe(1);
    expect(niceMaximum(-3)).toBe(1);
    expect(niceMaximum(Number.NaN)).toBe(1);
  });
});
