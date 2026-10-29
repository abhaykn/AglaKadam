import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { CrpExamsPage } from '@/features/exams/crp-exams-page';

export const Route = createFileRoute('/app/crp_/exams')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <CrpExamsPage />
    </RequireWorkspace>
  ),
});
