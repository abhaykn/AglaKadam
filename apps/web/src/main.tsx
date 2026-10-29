import '@/styles/index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderConfigurationProblem } from '@/app/configuration-problem';
import { createQueryClient } from '@/app/query-client';
import { createAppRouter } from '@/app/router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initialisePreferences } from '@/features/preferences/preferences';
import { initialiseInstallPrompt } from '@/features/pwa/install';
import { registerServiceWorker } from '@/features/pwa/service-worker';
import { initialiseI18n } from '@/i18n';
import { configurationIssues } from '@/lib/env';

const container = document.getElementById('root');
if (!container) {
  throw new Error('The #root element is missing from index.html.');
}

if (configurationIssues.length > 0) {
  renderConfigurationProblem(container, configurationIssues);
} else {
  initialisePreferences();
  initialiseI18n();
  initialiseInstallPrompt();
  registerServiceWorker();

  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);

  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
