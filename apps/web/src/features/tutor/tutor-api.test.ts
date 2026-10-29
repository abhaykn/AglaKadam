import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import { FunctionCallError } from '@/lib/functions';
import { tutorError, turnsToSend, type TutorMessage } from './tutor-api';

const message = (index: number, role: 'user' | 'assistant'): TutorMessage => ({
  id: String(index),
  role,
  text: `message ${String(index)}`,
});

const t = ((key: string) => {
  const found = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof found === 'string' ? found : key;
}) as unknown as TFunction;

describe('what is sent to Disha', () => {
  it('sends the latest turns, beginning with a message of the person', () => {
    const conversation = Array.from({ length: 41 }, (_, index) =>
      message(index, index % 2 === 0 ? 'user' : 'assistant'),
    );
    const sent = turnsToSend(conversation);
    expect(sent.length).toBeLessThanOrEqual(16);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)?.text).toBe('message 40');
  });

  it('sends a short conversation whole', () => {
    expect(turnsToSend([message(0, 'user'), message(1, 'assistant'), message(2, 'user')])).toEqual([
      { role: 'user', text: 'message 0' },
      { role: 'assistant', text: 'message 1' },
      { role: 'user', text: 'message 2' },
    ]);
  });
});

describe('keeping a long conversation within what the function accepts', () => {
  it('leaves out the oldest turns when the whole is too long', () => {
    const long = (index: number, role: 'user' | 'assistant'): TutorMessage => ({
      id: String(index),
      role,
      text: 'x'.repeat(role === 'assistant' ? 3500 : 400),
    });
    const conversation = Array.from({ length: 15 }, (_, index) =>
      long(index, index % 2 === 0 ? 'user' : 'assistant'),
    );
    const sent = turnsToSend(conversation);
    expect(sent.reduce((total, turn) => total + turn.text.length, 0)).toBeLessThanOrEqual(12_000);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)?.role).toBe('user');
    // The turns alternate, as the function requires.
    sent.slice(1).forEach((turn, index) => {
      expect(turn.role).not.toBe(sent[index]?.role);
    });
  });
});

describe('why Disha could not answer', () => {
  it('names each reason in words', () => {
    const words = (code: string) => tutorError(new FunctionCallError(code, 400), t);
    expect(words('network')).toBe(en.tutor.errors.network);
    expect(words('quota_exceeded')).toBe(en.tutor.errors.quota);
    expect(words('ai_unavailable')).toBe(en.tutor.errors.unavailable);
    expect(words('ai_refused')).toBe(en.tutor.errors.refused);
    expect(words('not_configured')).toBe(en.tutor.errors.notConfigured);
    expect(words('forbidden')).toBe(en.tutor.errors.forbidden);
    expect(words('invalid_request')).toBe(en.tutor.errors.tooLong);
    expect(words('anything_else')).toBe(en.tutor.errors.other);
    expect(tutorError(new Error('boom'), t)).toBe(en.tutor.errors.other);
  });
});
