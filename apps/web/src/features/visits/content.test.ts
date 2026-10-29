import { describe, expect, it } from 'vitest';
import { FOCUS_ITEMS, MOMENT_TAGS, focusItem, type LocalText } from './observation-bank';
import { PRACTICES, practice } from './practice-library';

/** The codes the database accepts for focus items, moment tags and practices. */
const CODE = /^[a-z][a-z0-9-]{2,47}$/;
const DEVANAGARI = /[\u0900-\u097f]/;

function texts(value: unknown): LocalText[] {
  if (value && typeof value === 'object') {
    if ('en' in value && 'hi' in value) {
      return [value as LocalText];
    }
    return Object.values(value).flatMap(texts);
  }
  return [];
}

describe('the observation bank and the practice library', () => {
  it('uses unique codes the database accepts', () => {
    for (const list of [FOCUS_ITEMS, MOMENT_TAGS, PRACTICES]) {
      const codes = list.map((entry) => entry.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(code).toMatch(CODE);
      }
    }
  });

  it('has every text in English and in Hindi', () => {
    const all = [...FOCUS_ITEMS, ...MOMENT_TAGS, ...PRACTICES].flatMap(texts);
    expect(all.length).toBeGreaterThan(200);
    for (const text of all) {
      expect(text.en.trim()).not.toBe('');
      expect(text.hi.trim()).not.toBe('');
      expect(text.hi).toMatch(DEVANAGARI);
    }
  });

  it('links every focus item to practices that exist, and every practice back to an item', () => {
    for (const item of FOCUS_ITEMS) {
      expect(item.practices.length).toBeGreaterThan(0);
      for (const code of item.practices) {
        expect(practice(code), `${item.code} names ${code}`).toBeDefined();
      }
    }
    for (const entry of PRACTICES) {
      expect(focusItem(entry.checkItem), `${entry.code} checks ${entry.checkItem}`).toBeDefined();
      expect(entry.steps.length).toBeGreaterThanOrEqual(3);
      expect(entry.plan).toHaveLength(2);
    }
    // Every practice can be reached from at least one item.
    const reachable = new Set(FOCUS_ITEMS.flatMap((item) => item.practices));
    expect(PRACTICES.filter((entry) => !reachable.has(entry.code))).toEqual([]);
  });

  it('keeps moment tags short enough for a button', () => {
    for (const tag of MOMENT_TAGS) {
      expect(tag.text.en.length).toBeLessThanOrEqual(24);
      expect(tag.text.hi.length).toBeLessThanOrEqual(24);
    }
    expect(MOMENT_TAGS.some((tag) => tag.tone === 'strength')).toBe(true);
    expect(MOMENT_TAGS.some((tag) => tag.tone === 'concern')).toBe(true);
  });
});
