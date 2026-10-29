import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import hi from './locales/hi.json';

interface Messages {
  [key: string]: string | Messages;
}

function flatten(messages: Messages, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.set(path, value);
    } else {
      for (const [childPath, childValue] of flatten(value, path)) {
        entries.set(childPath, childValue);
      }
    }
  }
  return entries;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1] ?? '').sort();
}

const english = flatten(en);
const hindi = flatten(hi);

describe('translation catalogues', () => {
  it('define exactly the same keys in English and Hindi', () => {
    expect([...hindi.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('contain no empty messages', () => {
    for (const [key, message] of [...english, ...hindi]) {
      expect(message.trim(), key).not.toBe('');
    }
  });

  it('use the same interpolation variables in both languages', () => {
    for (const [key, message] of english) {
      expect(placeholders(hindi.get(key) ?? ''), key).toEqual(placeholders(message));
    }
  });
});
