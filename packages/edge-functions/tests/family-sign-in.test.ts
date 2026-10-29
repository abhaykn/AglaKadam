import { describe, expect, it } from 'vitest';
import { handleFamilySignIn } from '../../../supabase/functions/family-sign-in/handler.ts';
import type {
  FamilySignInServices,
  PinCheck,
} from '../../../supabase/functions/_shared/services.ts';

function servicesAnswering(
  check: PinCheck,
): FamilySignInServices & { checked: string[]; tokensFor: string[] } {
  const checked: string[] = [];
  const tokensFor: string[] = [];
  return {
    checked,
    tokensFor,
    verifyPin(learnerCode, pin, clientKey) {
      checked.push(`${learnerCode}:${pin}:${clientKey}`);
      return Promise.resolve(check);
    },
    createSignInToken(userId) {
      tokensFor.push(userId);
      return Promise.resolve('one-time-token');
    },
  };
}

const client = 'hashed-network';

describe('family sign-in', () => {
  it('returns a one-time token for the account the database matched', async () => {
    const services = servicesAnswering({ status: 'ok', userId: 'family-user' });
    const result = await handleFamilySignIn(
      { learner_code: '12345 67897', pin: '482915' },
      client,
      services,
    );
    expect(result).toEqual({ status: 200, body: { token_hash: 'one-time-token' } });
    expect(services.checked).toEqual([`1234567897:482915:${client}`]);
    expect(services.tokensFor).toEqual(['family-user']);
  });

  it('answers a wrong PIN without revealing whether the code exists', async () => {
    const services = servicesAnswering({ status: 'invalid' });
    const result = await handleFamilySignIn(
      { learner_code: '1234567897', pin: '000000' },
      client,
      services,
    );
    expect(result).toEqual({ status: 401, body: { error: { code: 'invalid_credentials' } } });
    expect(services.tokensFor).toEqual([]);
  });

  it('does not consult the database for a code with a wrong check digit', async () => {
    const services = servicesAnswering({ status: 'ok', userId: 'family-user' });
    const result = await handleFamilySignIn(
      { learner_code: '1234567890', pin: '482915' },
      client,
      services,
    );
    expect(result.status).toBe(401);
    expect(services.checked).toEqual([]);
  });

  it('reports a locked account with the waiting time', async () => {
    const services = servicesAnswering({ status: 'locked', retryAfterSeconds: 840 });
    const result = await handleFamilySignIn(
      { learner_code: '1234567897', pin: '482915' },
      client,
      services,
    );
    expect(result).toEqual({
      status: 429,
      body: { error: { code: 'locked', retry_after_seconds: 840 } },
    });
  });

  it('reports a paused network with the waiting time', async () => {
    const services = servicesAnswering({ status: 'throttled', retryAfterSeconds: 3300 });
    const result = await handleFamilySignIn(
      { learner_code: '1234567897', pin: '482915' },
      client,
      services,
    );
    expect(result).toEqual({
      status: 429,
      body: { error: { code: 'throttled', retry_after_seconds: 3300 } },
    });
    expect(services.tokensFor).toEqual([]);
  });

  it('rejects a PIN that is not six digits', async () => {
    const services = servicesAnswering({ status: 'ok', userId: 'family-user' });
    const result = await handleFamilySignIn(
      { learner_code: '1234567897', pin: '48291' },
      client,
      services,
    );
    expect(result).toMatchObject({ status: 400, body: { error: { field: 'pin' } } });
    expect(services.checked).toEqual([]);
  });
});
