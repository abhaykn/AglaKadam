import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { ClassExamsPage } from '@/features/exams/class-exams-page';

export const Route = createFileRoute('/app/exams/$classId')({
  component: ClassExamsRoute,
});

function ClassExamsRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireWorkspace workspace="teacher">
      <ClassExamsPage classSectionId={classId} />
    </RequireWorkspace>
  );
}
