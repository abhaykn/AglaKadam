import { passwordIssues } from '../_shared/accounts.ts';
import {
  failure,
  type HandlerResult,
  isRecord,
  ok,
  readString,
  RequestError,
  respondTo,
} from '../_shared/http.ts';
import type { CallerAccess, PasswordServices } from '../_shared/services.ts';

/**
 * Password change for staff.
 *
 * The caller must have signed in with their password within the last ten minutes. A stolen or
 * forgotten-open session therefore cannot be used to take over the account: the person has to prove
 * they know the current password first. Signing in again before changing satisfies this; right after
 * the first sign-in with a temporary password it is satisfied already.
 */

export const REAUTHENTICATION_WINDOW_SECONDS = 10 * 60;

/** When the session was established with a password, from the token's `amr` claim. */
export function passwordAuthenticatedAt(claims: Record<string, unknown> | null): number | null {
  const methods = claims?.['amr'];
  if (!Array.isArray(methods)) {
    return null;
  }
  let latest: number | null = null;
  for (const entry of methods) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method === 'password' && typeof timestamp === 'number') {
      latest = latest === null ? timestamp : Math.max(latest, timestamp);
    }
  }
  return latest;
}

export function handlePasswordChange(
  body: unknown,
  caller: CallerAccess,
  authenticatedAt: number | null,
  nowSeconds: number,
  services: PasswordServices,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    if (caller.accountKind !== 'staff') {
      return failure(403, 'forbidden');
    }
    if (await services.isDemonstration(caller.userId)) {
      return failure(403, 'demonstration');
    }
    if (
      authenticatedAt === null ||
      nowSeconds - authenticatedAt > REAUTHENTICATION_WINDOW_SECONDS
    ) {
      return failure(401, 'reauthentication_required');
    }

    const newPassword = readString(body, 'new_password', { maxLength: 200 });
    const issues = passwordIssues(newPassword, caller.mobile);
    if (issues.length > 0) {
      return failure(422, 'weak_password', { issues });
    }

    await services.setAuthPassword(caller.userId, newPassword);
    await services.setPasswordChangeRequired(caller.userId, false);
    await services.signOutOtherSessions();
    return ok({ changed: true });
  });
}
