import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '@/features/admin/audit-page';

export const Route = createFileRoute('/app/admin/audit')({
  component: AuditPage,
});
