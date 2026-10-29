import { useTranslation } from 'react-i18next';
import { FunctionCallError } from '@/lib/functions';

const KNOWN_CODES = [
  'mobile_in_use',
  'cannot_change_self',
  'forbidden',
  'not_found',
  'student_not_verified',
  'concurrent_update',
] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

function isKnownCode(code: string): code is KnownCode {
  return (KNOWN_CODES as readonly string[]).includes(code);
}

/**
 * Message for a failed administrative action, in the user's language. `fallback` replaces the
 * generic message when the reason is not one the user can act on.
 */
export function useActionErrorMessage() {
  const { t } = useTranslation();
  return (error: unknown, fallback?: string): string => {
    if (error instanceof FunctionCallError) {
      if (error.code === 'network') {
        return t('auth.errors.network');
      }
      if (isKnownCode(error.code)) {
        return t(`admin.errors.${error.code}`);
      }
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = String(error.message);
      if (message.includes('last active super administrator')) {
        return t('admin.errors.lastSuperAdmin');
      }
    }
    return fallback ?? t('admin.saveFailed');
  };
}
