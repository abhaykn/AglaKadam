import { createFileRoute } from '@tanstack/react-router';
import { AdminLayout } from '@/features/admin/admin-layout';

export const Route = createFileRoute('/app/admin')({
  component: AdminLayout,
});
