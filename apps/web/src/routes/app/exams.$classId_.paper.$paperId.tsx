import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { MarksPage } from '@/features/exams/marks-page';

export const Route = createFileRoute('/app/exams/$classId_/paper/$paperId')({
  component: MarksRoute,
});

function MarksRoute() {
  const { classId, paperId } = Route.useParams();
  return (
    <RequireWorkspace workspace="teacher">
      <MarksPage classSectionId={classId} paperId={paperId} />
    </RequireWorkspace>
  );
}
