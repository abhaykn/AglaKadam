import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { RehearsalPage } from '@/features/sahayak/rehearsal-page';

export const Route = createFileRoute('/app/crp_/rehearse')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <RehearsalPage />
    </RequireWorkspace>
  ),
});
