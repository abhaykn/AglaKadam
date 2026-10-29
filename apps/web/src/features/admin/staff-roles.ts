import type { StaffRole } from '@/features/auth/access';

/** Roles in the order they are offered when adding or moving staff. */
export const ASSIGNABLE_ROLES: readonly StaffRole[] = [
  'teacher',
  'crp',
  'block_officer',
  'district_officer',
  'super_admin',
];

export function isStaffRole(value: string): value is StaffRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}
