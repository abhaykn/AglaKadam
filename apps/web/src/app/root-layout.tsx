import { useQueryClient } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UpdateNotifier } from '@/components/layout/update-notifier';
import { Toaster } from '@/components/ui/toaster';
import { SignOutConfirmation, SigningOutOverlay } from '@/features/app-shell/sign-out-confirmation';
import { forgetPreviousUser } from './forget-previous-user';

/** Clears the cached queries whenever the signed-in user changes (see `forgetPreviousUser`). */
function useForgetPreviousUser() {
  const queryClient = useQueryClient();
  useEffect(() => forgetPreviousUser(queryClient), [queryClient]);
}

function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main-content"
      className="sr-only rounded-lg bg-primary px-4 py-2 font-medium text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      {t('common.skipToContent')}
    </a>
  );
}

/** Outermost frame rendered around every route. */
export function RootLayout() {
  useForgetPreviousUser();
  return (
    <>
      <SkipLink />
      <Outlet />
      <Toaster />
      <UpdateNotifier />
      <SignOutConfirmation />
      <SigningOutOverlay />
    </>
  );
}
