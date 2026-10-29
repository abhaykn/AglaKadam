import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { TeacherHome } from '@/features/workspaces/teacher-home';

export const Route = createFileRoute('/app/teacher')({
  component: () => (
    <RequireWorkspace workspace="teacher">
      <TeacherHome />
    </RequireWorkspace>
  ),
});
