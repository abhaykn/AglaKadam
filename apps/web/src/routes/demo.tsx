import { createFileRoute } from '@tanstack/react-router';
import { initialiseSession } from '@/features/auth/session';
import { isDemoRole, type DemoRole } from '@/features/demo/demo-api';
import { DemoPage } from '@/features/demo/demo-page';

interface DemoSearch {
  role?: DemoRole;
}

export const Route = createFileRoute('/demo')({
  validateSearch: (search: Record<string, unknown>): DemoSearch =>
    isDemoRole(search.role) ? { role: search.role } : {},
  beforeLoad: async () => {
    await initialiseSession();
  },
  component: DemoRoute,
});

function DemoRoute() {
  const { role } = Route.useSearch();
  return <DemoPage initialRole={role ?? null} />;
}
