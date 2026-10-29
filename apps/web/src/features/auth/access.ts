import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { sessionStore } from './session';
import { useStore } from '@/lib/store';

export type StaffRole = 'super_admin' | 'district_officer' | 'block_officer' | 'crp' | 'teacher';

export interface AccessScope {
  type: 'district' | 'block' | 'cluster' | 'school';
  id: string;
  code: string;
  name_en: string;
  name_hi: string | null;
}

export interface AccessAssignment {
  id: string;
  role: StaffRole;
  starts_on: string;
  ends_on: string | null;
  scope: AccessScope | null;
}

export interface AccessStudent {
  id: string;
  full_name: string;
  student_code: string;
  school: { id: string; name_en: string; name_hi: string | null } | null;
  class: { id: string; grade: number; section: string } | null;
}

/** Result of `public.my_access()`: who the signed-in user is and what they may do. */
export interface Access {
  user_id: string;
  account_kind: 'staff' | 'student';
  full_name: string;
  preferred_language: 'en' | 'hi';
  phone: string | null;
  is_active: boolean;
  password_change_required: boolean;
  assignments: AccessAssignment[];
  student: AccessStudent | null;
}

/** A workspace the user can open, in the order they are offered. */
export type Workspace = 'admin' | 'crp' | 'teacher' | 'officer' | 'family';

export function workspacesOf(access: Access): Workspace[] {
  if (access.account_kind === 'student') {
    return access.student ? ['family'] : [];
  }
  const roles = new Set(access.assignments.map((assignment) => assignment.role));
  const workspaces: Workspace[] = [];
  if (roles.has('super_admin')) {
    workspaces.push('admin');
  }
  if (roles.has('crp')) {
    workspaces.push('crp');
  }
  if (roles.has('teacher')) {
    workspaces.push('teacher');
  }
  if (roles.has('district_officer') || roles.has('block_officer')) {
    workspaces.push('officer');
  }
  return workspaces;
}

export function hasRole(access: Access, role: StaffRole): boolean {
  return access.assignments.some((assignment) => assignment.role === role);
}

export function scopesFor(access: Access, role: StaffRole): AccessScope[] {
  return access.assignments.flatMap((assignment) =>
    assignment.role === role && assignment.scope ? [assignment.scope] : [],
  );
}

export function accessQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: ['access', userId],
    meta: { persist: true },
    enabled: userId !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Access | null> => {
      const { data, error } = await getSupabase().rpc('my_access');
      if (error) {
        throw error;
      }
      return (data as Access | null) ?? null;
    },
  });
}

/** Access of the signed-in user. `data` is null for an account that has not been provisioned. */
export function useAccess() {
  const userId = useStore(sessionStore, (state) =>
    state.status === 'signed-in' ? state.userId : null,
  );
  return useQuery(accessQueryOptions(userId));
}
