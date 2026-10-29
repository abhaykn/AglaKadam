import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { CrpHome } from '@/features/workspaces/crp-home';

export const Route = createFileRoute('/app/crp')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <CrpHome />
    </RequireWorkspace>
  ),
});
