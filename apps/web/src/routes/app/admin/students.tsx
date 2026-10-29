import { createFileRoute } from '@tanstack/react-router';
import { StudentsPage } from '@/features/admin/students-page';

export const Route = createFileRoute('/app/admin/students')({
  component: StudentsPage,
});
