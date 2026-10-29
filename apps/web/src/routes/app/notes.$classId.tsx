import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { ClassNotesPage } from '@/features/class-notes/class-notes-page';

export const Route = createFileRoute('/app/notes/$classId')({
  component: ClassNotesRoute,
});

function ClassNotesRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireWorkspace workspace="teacher">
      <ClassNotesPage classSectionId={classId} />
    </RequireWorkspace>
  );
}
