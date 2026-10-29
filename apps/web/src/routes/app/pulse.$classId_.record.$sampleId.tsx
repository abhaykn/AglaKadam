import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { RecordCheckPage } from '@/features/pulse/record-check-page';

interface RecordSearch {
  attempt: 1 | 2;
}

export const Route = createFileRoute('/app/pulse/$classId_/record/$sampleId')({
  // Only a second attempt is asked for explicitly; anything else is the first.
  validateSearch: (search: Record<string, unknown>): RecordSearch => ({
    attempt: search.attempt === 2 || search.attempt === '2' ? 2 : 1,
  }),
  component: RecordRoute,
});

function RecordRoute() {
  const { classId, sampleId } = Route.useParams();
  const { attempt } = Route.useSearch();
  return (
    <RequireWorkspace workspace="teacher">
      <RecordCheckPage
        key={`${sampleId}:${String(attempt)}`}
        classSectionId={classId}
        sampleId={sampleId}
        attempt={attempt}
      />
    </RequireWorkspace>
  );
}
