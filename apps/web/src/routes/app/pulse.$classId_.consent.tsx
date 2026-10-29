import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { ConsentPage } from '@/features/consent/consent-page';

export const Route = createFileRoute('/app/pulse/$classId_/consent')({
  component: ConsentRoute,
});

function ConsentRoute() {
  const { classId } = Route.useParams();
  return (
    <RequireWorkspace workspace="teacher">
      <ConsentPage classSectionId={classId} />
    </RequireWorkspace>
  );
}
