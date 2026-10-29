import { createFileRoute } from '@tanstack/react-router';
import { AcademicYearsPage } from '@/features/admin/academic-years-page';

export const Route = createFileRoute('/app/admin/academic-years')({
  component: AcademicYearsPage,
});
