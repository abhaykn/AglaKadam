import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { CrpCodesPage } from '@/features/pulse/crp-codes-page';

export const Route = createFileRoute('/app/crp_/pulse-codes')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <CrpCodesPage />
    </RequireWorkspace>
  ),
});
