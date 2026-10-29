import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { RootLayout } from '@/app/root-layout';
import { NotFoundPage } from '@/components/feedback/not-found-page';
import { RouteErrorPage } from '@/components/feedback/route-error-page';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});
