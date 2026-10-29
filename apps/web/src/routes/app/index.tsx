import { createFileRoute } from '@tanstack/react-router';
import { HomeRedirect } from '@/features/app-shell/home-redirect';

export const Route = createFileRoute('/app/')({
  component: HomeRedirect,
});
