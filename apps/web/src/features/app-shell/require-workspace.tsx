import { Link } from '@tanstack/react-router';
import { ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPage } from '@/components/feedback/status-page';
import { Button } from '@/components/ui/button';
import { workspacesOf, type Workspace } from '@/features/auth/access';
import { useCurrentAccess } from './access-context';

/**
 * Renders a workspace only for people who hold the matching role. The database enforces the same
 * rule; this keeps people from landing on screens that would only show refusals.
 */
export function RequireWorkspace({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  if (workspacesOf(access).includes(workspace)) {
    return children;
  }
  return (
    <StatusPage
      icon={ShieldX}
      title={t('app.notAllowed.title')}
      body={t('app.notAllowed.body')}
      actions={
        <Button asChild>
          <Link to="/app">{t('app.home')}</Link>
        </Button>
      }
    />
  );
}

/** Renders a page for people who hold any of the given roles, for example CRPs and teachers. */
export function RequireAnyWorkspace({
  workspaces,
  children,
}: {
  workspaces: readonly Workspace[];
  children: ReactNode;
}) {
  const access = useCurrentAccess();
  const held = workspacesOf(access);
  const allowed = workspaces.find((workspace) => held.includes(workspace)) ?? workspaces[0];
  return allowed ? <RequireWorkspace workspace={allowed}>{children}</RequireWorkspace> : null;
}
