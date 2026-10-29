import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { normaliseMobile, staffEmailForMobile } from '@shared/accounts.ts';
import { callFunction, FunctionCallError } from '@/lib/functions';
import { getSupabase } from '@/lib/supabase';
import { forgetStoredSession } from './session';

export type SignInFailure =
  | 'invalid_identifier'
  | 'invalid_credentials'
  | 'account_blocked'
  | 'locked'
  | 'throttled'
  | 'rate_limited'
  | 'network'
  | 'unexpected';

export class SignInError extends Error {
  constructor(
    readonly reason: SignInFailure,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Sign-in failed: ${reason}`);
    this.name = 'SignInError';
  }
}

/**
 * Staff sign in with their mobile number. An address containing `@` is accepted too, for the first
 * super administrator, who is created with a real email address during set-up.
 */
export function staffSignInEmail(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed.toLowerCase() : null;
  }
  const mobile = normaliseMobile(trimmed);
  return mobile ? staffEmailForMobile(mobile) : null;
}

function toSignInError(error: unknown): SignInError {
  if (isAuthRetryableFetchError(error)) {
    return new SignInError('network');
  }
  if (isAuthApiError(error)) {
    if (error.code === 'invalid_credentials') {
      return new SignInError('invalid_credentials');
    }
    if (error.code === 'user_banned') {
      return new SignInError('account_blocked');
    }
    if (error.status === 429 || error.code === 'over_request_rate_limit') {
      return new SignInError('rate_limited');
    }
  }
  return new SignInError('unexpected');
}

export async function signInStaff(identifier: string, password: string): Promise<void> {
  const email = staffSignInEmail(identifier);
  if (!email) {
    throw new SignInError('invalid_identifier');
  }
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) {
    throw toSignInError(error);
  }
}

/**
 * Family sign-in. The learner code and PIN are checked by the `family-sign-in` function, which
 * answers with a one-time token; this device then exchanges the token for its own session.
 */
export async function signInFamily(learnerCode: string, pin: string): Promise<void> {
  let tokenHash: string;
  try {
    const result = await callFunction<{ token_hash: string }>('family-sign-in', {
      learner_code: learnerCode,
      pin,
    });
    tokenHash = result.token_hash;
  } catch (error) {
    if (error instanceof FunctionCallError) {
      if (error.code === 'invalid_credentials' || error.code === 'invalid_request') {
        throw new SignInError('invalid_credentials');
      }
      if (error.code === 'locked' || error.code === 'throttled') {
        const seconds = error.details.retry_after_seconds;
        throw new SignInError(error.code, typeof seconds === 'number' ? seconds : null);
      }
      if (error.code === 'network') {
        throw new SignInError('network');
      }
    }
    throw new SignInError('unexpected');
  }

  const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (error) {
    throw toSignInError(error);
  }
}

/** How long signing out waits for the Auth client before removing the session itself. */
const SIGN_OUT_WAIT_MS = 2000;

/**
 * Signs out on this device. Works offline: the local session is removed either way.
 *
 * The Auth client keeps the session when it cannot load it (offline with an expired access token),
 * and it waits for any token refresh in progress, which can take about 25 seconds on a poor
 * connection. In those cases the stored session is removed directly, and removed again once the
 * Auth client has finished, so that a refresh completing later cannot sign the person back in.
 */
export async function signOut(): Promise<void> {
  const attempt = getSupabase()
    .auth.signOut({ scope: 'local' })
    .then(
      ({ error }) => error === null,
      () => false,
    );
  const signedOut = await Promise.race([
    attempt,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), SIGN_OUT_WAIT_MS)),
  ]);
  if (!signedOut) {
    await forgetStoredSession();
    void attempt.then(async (succeeded) => {
      if (!succeeded) {
        await forgetStoredSession();
      }
    });
  }
}
