import { createFileRoute } from '@tanstack/react-router';
import { OverviewPage } from '@/features/admin/overview-page';

export const Route = createFileRoute('/app/admin/')({
  component: OverviewPage,
});
