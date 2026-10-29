import { workspacesOf, type Access, type Workspace } from '@/features/auth/access';

/** The kind of person the account is speaking as: the workspace being used, else the first one. */
export function workspaceInUse(pathname: string, access: Access): Workspace | null {
  const workspaces = workspacesOf(access);
  const current = workspaces.find(
    (workspace) => pathname === `/app/${workspace}` || pathname.startsWith(`/app/${workspace}/`),
  );
  return current ?? workspaces[0] ?? null;
}
