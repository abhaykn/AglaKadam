import { describe, expect, it } from 'vitest';
import {
  handlePasswordChange,
  passwordAuthenticatedAt,
  REAUTHENTICATION_WINDOW_SECONDS,
} from '../../../supabase/functions/account-password/handler.ts';
import type { PasswordServices } from '../../../supabase/functions/_shared/services.ts';
import { callerWith } from './support/fake-services';

function recordingServices(demonstration = false): PasswordServices & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isDemonstration() {
      return Promise.resolve(demonstration);
    },
    setAuthPassword(userId, password) {
      calls.push(`password:${userId}:${password}`);
      return Promise.resolve();
    },
    setPasswordChangeRequired(userId, required) {
      calls.push(`required:${userId}:${String(required)}`);
      return Promise.resolve();
    },
    signOutOtherSessions() {
      calls.push('sign-out-others');
      return Promise.resolve();
    },
  };
}

const now = 1_800_000_000;
const teacher = callerWith({ userId: 'teacher', mobile: '9876543210' });

describe('passwordAuthenticatedAt', () => {
  it('reads the latest password sign-in from the amr claim', () => {
    expect(
      passwordAuthenticatedAt({
        amr: [
          { method: 'password', timestamp: 100 },
          { method: 'otp', timestamp: 300 },
          { method: 'password', timestamp: 200 },
        ],
      }),
    ).toBe(200);
  });

  it('returns null without a password sign-in', () => {
    expect(passwordAuthenticatedAt(null)).toBeNull();
    expect(passwordAuthenticatedAt({ amr: [{ method: 'otp', timestamp: 1 }] })).toBeNull();
    expect(passwordAuthenticatedAt({ amr: 'password' })).toBeNull();
  });
});

describe('changing a password', () => {
  it('sets the password, clears the requirement and ends other sessions', async () => {
    const services = recordingServices();
    const result = await handlePasswordChange(
      { new_password: 'naya2026kadam' },
      teacher,
      now - 60,
      now,
      services,
    );
    expect(result.status).toBe(200);
    expect(services.calls).toEqual([
      'password:teacher:naya2026kadam',
      'required:teacher:false',
      'sign-out-others',
    ]);
  });

  it('requires a recent password sign-in', async () => {
    const services = recordingServices();
    for (const authenticatedAt of [null, now - REAUTHENTICATION_WINDOW_SECONDS - 1]) {
      const result = await handlePasswordChange(
        { new_password: 'naya2026kadam' },
        teacher,
        authenticatedAt,
        now,
        services,
      );
      expect(result).toMatchObject({
        status: 401,
        body: { error: { code: 'reauthentication_required' } },
      });
    }
    expect(services.calls).toEqual([]);
  });

  it('explains why a weak password was refused', async () => {
    const services = recordingServices();
    const result = await handlePasswordChange(
      { new_password: '9876543210' },
      teacher,
      now,
      now,
      services,
    );
    expect(result).toMatchObject({
      status: 422,
      body: { error: { code: 'weak_password', issues: ['needs_letter', 'contains_mobile'] } },
    });
    expect(services.calls).toEqual([]);
  });

  it('keeps the password of a demonstration account', async () => {
    const services = recordingServices(true);
    const result = await handlePasswordChange(
      { new_password: 'naya2026kadam' },
      teacher,
      now,
      now,
      services,
    );
    expect(result).toMatchObject({ status: 403, body: { error: { code: 'demonstration' } } });
    expect(services.calls).toEqual([]);
  });

  it('is not available to family accounts', async () => {
    const result = await handlePasswordChange(
      { new_password: 'naya2026kadam' },
      callerWith({ accountKind: 'student' }),
      now,
      now,
      recordingServices(),
    );
    expect(result.status).toBe(403);
  });

  it('rejects a missing password', async () => {
    const result = await handlePasswordChange({}, teacher, now, now, recordingServices());
    expect(result).toMatchObject({ status: 400, body: { error: { field: 'new_password' } } });
  });
});
