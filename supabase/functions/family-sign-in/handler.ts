import { isValidLearnerCode, PIN_PATTERN } from '../_shared/accounts.ts';
import {
  failure,
  type HandlerResult,
  isRecord,
  ok,
  readString,
  RequestError,
  respondTo,
} from '../_shared/http.ts';
import type { FamilySignInServices } from '../_shared/services.ts';

/**
 * Family sign-in with the learner code printed on the slip and a six-digit PIN.
 *
 * The PIN is checked in the database, which also counts failures and locks the account. On success
 * the response carries a one-time token rather than a session: the family's device exchanges it with
 * the Auth service itself, so the session is created for that device and the Auth service's own
 * per-device limits apply. An unknown code and a wrong PIN produce the same answer, and failures
 * from one client network are limited as a whole, so many codes cannot be tried from one place.
 */
export function handleFamilySignIn(
  body: unknown,
  clientKey: string,
  services: FamilySignInServices,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    const learnerCode = readString(body, 'learner_code', { maxLength: 20 }).replace(/\s/g, '');
    const pin = readString(body, 'pin', { maxLength: 6, pattern: PIN_PATTERN });

    if (!isValidLearnerCode(learnerCode)) {
      return failure(401, 'invalid_credentials');
    }

    const check = await services.verifyPin(learnerCode, pin, clientKey);
    if (check.status === 'locked' || check.status === 'throttled') {
      return failure(429, check.status, { retry_after_seconds: check.retryAfterSeconds });
    }
    if (check.status !== 'ok') {
      return failure(401, 'invalid_credentials');
    }

    // The token is made for the account the database matched, never for an address derived from
    // the request.
    const tokenHash = await services.createSignInToken(check.userId);
    return ok({ token_hash: tokenHash });
  });
}
