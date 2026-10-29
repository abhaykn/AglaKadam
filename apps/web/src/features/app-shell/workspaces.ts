import type { Workspace } from '@/features/auth/access';

export const workspacePaths = {
  admin: '/app/admin',
  crp: '/app/crp',
  teacher: '/app/teacher',
  officer: '/app/officer',
  family: '/app/family',
} as const satisfies Record<Workspace, string>;
