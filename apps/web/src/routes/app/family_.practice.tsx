import { createFileRoute } from '@tanstack/react-router';
import { RequireWorkspace } from '@/features/app-shell/require-workspace';
import { PracticePage } from '@/features/practice/practice-page';

export const Route = createFileRoute('/app/family_/practice')({
  component: () => (
    <RequireWorkspace workspace="family">
      <PracticePage />
    </RequireWorkspace>
  ),
});
