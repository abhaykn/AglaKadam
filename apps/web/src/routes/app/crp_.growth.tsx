import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { MyCoachingPage } from '@/features/progress/my-coaching-page';

export const Route = createFileRoute('/app/crp_/growth')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <MyCoachingPage />
    </RequireWorkspace>
  ),
});
