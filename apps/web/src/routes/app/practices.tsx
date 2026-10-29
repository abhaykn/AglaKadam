import { createFileRoute } from '@tanstack/react-router';
import { RequireAnyWorkspace } from '@/features/app-shell/require-workspace';
import { PracticeLibraryPage } from '@/features/visits/practice-library-page';

export const Route = createFileRoute('/app/practices')({
  component: () => (
    <RequireAnyWorkspace workspaces={['crp', 'teacher']}>
      <PracticeLibraryPage />
    </RequireAnyWorkspace>
  ),
});
