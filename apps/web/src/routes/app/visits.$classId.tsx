import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { TeacherVisitsPage } from '@/features/visits/teacher-visits-page';

export const Route = createFileRoute('/app/visits/$classId')({
  component: TeacherVisitsRoute,
});

function TeacherVisitsRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireWorkspace workspace="teacher">
      <TeacherVisitsPage classSectionId={classId} />
    </RequireWorkspace>
  );
}
