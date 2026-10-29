import { Navigate } from '@tanstack/react-router';
import { workspacesOf } from '@/features/auth/access';
import { useCurrentAccess } from './access-context';
import { workspacePaths } from './workspaces';

/** Opens the first workspace of the signed-in user; the shell has already checked there is one. */
export function HomeRedirect() {
  const access = useCurrentAccess();
  const [first] = workspacesOf(access);
  return first ? <Navigate to={workspacePaths[first]} replace /> : null;
}
