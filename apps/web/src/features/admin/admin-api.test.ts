import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionCallError } from '@/lib/functions';
import type * as FunctionsModule from '@/lib/functions';
import { createStaff, searchTerm, type StaffDraft } from './admin-api';

const callFunction = vi.hoisted(() => vi.fn());

vi.mock('@/lib/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof FunctionsModule>()),
  callFunction,
}));

describe('searchTerm', () => {
  it('finds names whatever punctuation is typed', () => {
    expect(searchTerm('G.P.S. Rampur')).toBe('G*P*S*Rampur');
    expect(searchTerm('R.K. Sharma')).toBe('R*K*Sharma');
    expect(searchTerm('रा.प्रा.वि.')).toBe('रा*प्रा*वि');
  });

  it('cannot add filters or change the pattern', () => {
    expect(searchTerm('a,b)or(c')).toBe('a*b*or*c');
    expect(searchTerm('100% "x" \\ y:z')).toBe('100*x*y*z');
  });

  it('keeps ordinary text and drops what is left of punctuation alone', () => {
    expect(searchTerm('  Asha   Devi ')).toBe('Asha Devi');
    expect(searchTerm('...')).toBe('');
  });
});

function drafts(count: number): StaffDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    full_name: `Person ${String(index)}`,
    mobile: `98765${String(index).padStart(5, '0')}`,
    role: 'teacher',
    scope_id: 'school',
    preferred_language: 'hi',
  }));
}

function created(count: number) {
  return {
    results: Array.from({ length: count }, (_, index) => ({
      index,
      status: 'created',
      user_id: `user-${String(index)}`,
      full_name: `Person ${String(index)}`,
      mobile: '9876500000',
      temporary_password: `secret${String(index)}`,
    })),
  };
}

describe('createStaff', () => {
  beforeEach(() => {
    callFunction.mockReset();
  });

  it('sends at most one hundred accounts per request and numbers the rows across requests', async () => {
    callFunction.mockResolvedValueOnce(created(100)).mockResolvedValueOnce(created(20));
    const outcomes = await createStaff(drafts(120));
    expect(callFunction).toHaveBeenCalledTimes(2);
    expect(outcomes).toHaveLength(120);
    expect(outcomes[119]).toMatchObject({ index: 119, status: 'created' });
  });

  it('keeps the accounts already created when a later request is interrupted', async () => {
    callFunction
      .mockResolvedValueOnce(created(100))
      .mockRejectedValueOnce(new FunctionCallError('network', 0));
    const outcomes = await createStaff(drafts(250));
    expect(outcomes.filter((outcome) => outcome.status === 'created')).toHaveLength(100);
    expect(outcomes.slice(100)).toEqual(
      Array.from({ length: 150 }, (_, offset) => ({
        index: 100 + offset,
        status: 'failed',
        error: 'unconfirmed',
      })),
    );
  });

  it('reports every row as unconfirmed when the first request is interrupted', async () => {
    callFunction.mockRejectedValueOnce(new FunctionCallError('internal_error', 500));
    const outcomes = await createStaff(drafts(3));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'failed', 'failed']);
  });

  it('fails as a whole when the first request is refused, because nothing was created', async () => {
    callFunction.mockRejectedValueOnce(new FunctionCallError('forbidden', 403));
    await expect(createStaff(drafts(3))).rejects.toBeInstanceOf(FunctionCallError);
  });
});
