import { createFileRoute } from '@tanstack/react-router';
import { SchoolsPage } from '@/features/admin/schools-page';

export const Route = createFileRoute('/app/admin/schools')({
  component: SchoolsPage,
});
