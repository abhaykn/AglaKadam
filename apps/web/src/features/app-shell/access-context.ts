import { createContext, use } from 'react';
import type { Access } from '@/features/auth/access';

export const AccessContext = createContext<Access | null>(null);

/** Access of the signed-in user inside the application shell, where it is always loaded. */
export function useCurrentAccess(): Access {
  const access = use(AccessContext);
  if (!access) {
    throw new Error('useCurrentAccess must be used inside the application shell.');
  }
  return access;
}
