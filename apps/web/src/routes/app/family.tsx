import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { FamilyHome } from '@/features/workspaces/family-home';

export const Route = createFileRoute('/app/family')({
  component: () => (
    <RequireWorkspace workspace="family">
      <FamilyHome />
    </RequireWorkspace>
  ),
});
