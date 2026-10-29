import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { PlanPage } from '@/features/visits/plan-page';

export const Route = createFileRoute('/app/crp_/plan')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <PlanPage />
    </RequireWorkspace>
  ),
});
