import { createFileRoute } from '@tanstack/react-router';
import { RequireAnyWorkspace } from '@/features/app-shell/require-workspace';
import { ChildProgressPage } from '@/features/progress/child-progress-page';

export const Route = createFileRoute('/app/child/$studentId')({
  component: ChildProgressRoute,
});

function ChildProgressRoute() {
  const { studentId } = Route.useParams();
  return (
    <RequireAnyWorkspace workspaces={['teacher', 'crp']}>
      <ChildProgressPage studentId={studentId} />
    </RequireAnyWorkspace>
  );
}
