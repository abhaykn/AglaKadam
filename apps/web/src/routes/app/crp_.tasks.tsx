import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { TasksPage } from '@/features/visits/tasks-page';

export const Route = createFileRoute('/app/crp_/tasks')({
  component: () => (
    <RequireWorkspace workspace="crp">
      <TasksPage />
    </RequireWorkspace>
  ),
});
