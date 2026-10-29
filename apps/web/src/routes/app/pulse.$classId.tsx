import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { PulsePage } from '@/features/pulse/pulse-page';

export const Route = createFileRoute('/app/pulse/$classId')({
  component: PulseRoute,
});

function PulseRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireWorkspace workspace="teacher">
      <PulsePage classSectionId={classId} />
    </RequireWorkspace>
  );
}
