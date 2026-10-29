import { createFileRoute } from '@tanstack/react-router';
import { RequireAnyWorkspace } from '@/features/app-shell/require-workspace';
import { ClassProgressPage } from '@/features/progress/class-progress-page';

export const Route = createFileRoute('/app/progress/$classId')({
  component: ClassProgressRoute,
});

function ClassProgressRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireAnyWorkspace workspaces={['teacher', 'crp']}>
      <ClassProgressPage classSectionId={classId} />
    </RequireAnyWorkspace>
  );
}
