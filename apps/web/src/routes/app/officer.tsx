import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { OfficerHome } from '@/features/workspaces/officer-home';

export const Route = createFileRoute('/app/officer')({
  component: () => (
    <RequireWorkspace workspace="officer">
      <OfficerHome />
    </RequireWorkspace>
  ),
});
