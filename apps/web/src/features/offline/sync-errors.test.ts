import { describe, expect, it } from 'vitest';
import { FunctionCallError } from '@/lib/functions';
import { classifyFailure, retryDelay } from './sync-errors';

describe('classifyFailure', () => {
  it.each([
    [{ code: '', message: 'TypeError: Failed to fetch' }, 'retry'],
    [{ code: '40001', message: 'serialization failure' }, 'retry'],
    [{ code: '08006', message: 'connection failure' }, 'retry'],
    [{ code: '57014', message: 'canceled' }, 'retry'],
    [{ code: 'PGRST303', message: 'JWT expired' }, 'reauthenticate'],
    [{ code: '42501', message: 'row-level security' }, 'reject'],
    [{ code: '23514', message: 'Attendance cannot be marked for a future date.' }, 'reject'],
    [{ code: '22P02', message: 'invalid input' }, 'reject'],
    [{ code: 'PGRST204', message: 'column not found' }, 'reject'],
  ])('treats %o as %s', (error, kind) => {
    expect(classifyFailure(error).kind).toBe(kind);
  });

  it('handles Edge Function failures by status', () => {
    expect(classifyFailure(new FunctionCallError('network', 0)).kind).toBe('retry');
    expect(classifyFailure(new FunctionCallError('internal_error', 500)).kind).toBe('retry');
    expect(classifyFailure(new FunctionCallError('throttled', 429)).kind).toBe('retry');
    expect(classifyFailure(new FunctionCallError('unauthorized', 401)).kind).toBe('reauthenticate');
    expect(classifyFailure(new FunctionCallError('forbidden', 403)).kind).toBe('reject');
  });

  it('labels missing codes as a network problem', () => {
    expect(classifyFailure(new Error('offline')).code).toBe('network');
  });
});

describe('retryDelay', () => {
  it('starts at about 15 seconds and doubles up to 30 minutes', () => {
    const middle = () => 0.5;
    expect(retryDelay(1, middle)).toBe(15_000);
    expect(retryDelay(2, middle)).toBe(30_000);
    expect(retryDelay(3, middle)).toBe(60_000);
    expect(retryDelay(20, middle)).toBe(30 * 60_000);
  });

  it('spreads retries by up to 20 percent either way', () => {
    expect(retryDelay(1, () => 0)).toBe(12_000);
    expect(retryDelay(1, () => 0.999999)).toBeLessThanOrEqual(18_000);
  });
});
