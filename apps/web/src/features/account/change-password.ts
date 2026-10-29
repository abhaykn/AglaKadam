import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { PasswordIssue } from '@shared/accounts.ts';
import { callFunction, FunctionCallError } from '@/lib/functions';
import { getSupabase } from '@/lib/supabase';

export type PasswordChangeFailure =
  | { reason: 'current_password_incorrect' }
  | { reason: 'reauthentication_required' }
  | { reason: 'weak_password'; issues: PasswordIssue[] }
  | { reason: 'network' }
  | { reason: 'unexpected' };

export class PasswordChangeError extends Error {
  constructor(readonly failure: PasswordChangeFailure) {
    super(`Password change failed: ${failure.reason}`);
    this.name = 'PasswordChangeError';
  }
}

/**
 * Changes the signed-in staff member's password.
 *
 * The password service only accepts a change shortly after a password sign-in. When the current
 * password is supplied, the user is signed in again with it first, which both proves knowledge of it
 * and satisfies that requirement; other devices are signed out once the change succeeds.
 */
export async function changePassword(input: {
  email: string | null;
  currentPassword: string | null;
  newPassword: string;
}): Promise<void> {
  const supabase = getSupabase();

  if (input.currentPassword !== null) {
    if (!input.email) {
      throw new PasswordChangeError({ reason: 'unexpected' });
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.currentPassword,
    });
    if (error) {
      if (isAuthRetryableFetchError(error)) {
        throw new PasswordChangeError({ reason: 'network' });
      }
      if (isAuthApiError(error) && error.code === 'invalid_credentials') {
        throw new PasswordChangeError({ reason: 'current_password_incorrect' });
      }
      throw new PasswordChangeError({ reason: 'unexpected' });
    }
  }

  try {
    await callFunction('account-password', { new_password: input.newPassword });
  } catch (error) {
    if (error instanceof FunctionCallError) {
      if (error.code === 'reauthentication_required') {
        throw new PasswordChangeError({ reason: 'reauthentication_required' });
      }
      if (error.code === 'weak_password') {
        const issues = Array.isArray(error.details.issues)
          ? (error.details.issues as PasswordIssue[])
          : [];
        throw new PasswordChangeError({ reason: 'weak_password', issues });
      }
      if (error.code === 'network') {
        throw new PasswordChangeError({ reason: 'network' });
      }
    }
    throw new PasswordChangeError({ reason: 'unexpected' });
  }
}
