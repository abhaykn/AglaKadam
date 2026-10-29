import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { ClassPackPage } from '@/features/visits/class-pack-page';

export const Route = createFileRoute('/app/crp_/class/$classId')({
  component: ClassPackRoute,
});

function ClassPackRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireWorkspace workspace="crp">
      <ClassPackPage classSectionId={classId} />
    </RequireWorkspace>
  );
}
