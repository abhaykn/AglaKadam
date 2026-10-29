import { createFileRoute } from '@tanstack/react-router';
import { StaffPage } from '@/features/admin/staff-page';

export const Route = createFileRoute('/app/admin/staff')({
  component: StaffPage,
});
