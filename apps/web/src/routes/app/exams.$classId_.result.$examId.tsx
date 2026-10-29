import { createFileRoute } from '@tanstack/react-router';
import { RequireAnyWorkspace } from '@/features/app-shell/require-workspace';
import { ResultSheetPage } from '@/features/exams/result-sheet-page';

export const Route = createFileRoute('/app/exams/$classId_/result/$examId')({
  component: ResultSheetRoute,
});

function ResultSheetRoute() {
  const { classId, examId } = Route.useParams();
  return (
    <RequireAnyWorkspace workspaces={['teacher', 'crp']}>
      <ResultSheetPage classSectionId={classId} examId={examId} />
    </RequireAnyWorkspace>
  );
}
