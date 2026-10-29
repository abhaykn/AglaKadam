import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { VisitPage } from '@/features/visits/visit-page';

export const Route = createFileRoute('/app/crp_/visit/$visitId')({
  component: VisitRoute,
});

function VisitRoute() {
  const { visitId } = Route.useParams();
  return (
    <RequireWorkspace workspace="crp">
      <VisitPage visitId={visitId} />
    </RequireWorkspace>
  );
}
