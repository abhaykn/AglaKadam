import { createFileRoute } from '@tanstack/react-router';
import { ChangePasswordPage } from '@/features/account/change-password-page';

export const Route = createFileRoute('/app/change-password')({
  component: ChangePasswordPage,
});
