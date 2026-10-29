import { Link, Navigate, Outlet, useLocation } from '@tanstack/react-router';
import { CircleSlash, LogOut, RotateCcw, UserX, WifiOff } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/brand/logo';
import { StatusPage } from '@/components/feedback/status-page';
import { EducationBackdrop } from '@/components/layout/education-backdrop';
import { ConnectivityIndicator } from '@/components/layout/connectivity-indicator';
import { InstallButton } from '@/components/layout/install-button';
import { LanguageSwitch } from '@/components/layout/language-switch';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccess, workspacesOf, type Access } from '@/features/auth/access';
import { DemoBanner } from '@/features/demo/demo-banner';
import { sessionStore } from '@/features/auth/session';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { SyncIndicator } from '@/features/offline/sync-center';
import { TutorLauncher } from '@/features/tutor/tutor-launcher';
import { setLanguage } from '@/features/preferences/preferences';
import { getEnv } from '@/lib/env';
import { readLocal, writeLocal } from '@/lib/local-storage';
import { useStore } from '@/lib/store';
import { useDocumentTitle } from '@/lib/use-document-title';
import { AccessContext } from './access-context';
import { AccountMenu } from './account-menu';
import { ToSignIn } from './to-sign-in';
import { useSignOut } from './use-sign-out';
import { WorkspaceSwitcher } from './workspace-switcher';

const LANGUAGE_SYNCED_KEY = 'ak.language.synced-for';

/**
 * Applies the language saved in the profile the first time an account is used on this device.
 * Later changes made with the language switch stay on the device.
 */
function useProfileLanguageOnFirstUse(access: Access) {
  useEffect(() => {
    if (readLocal(LANGUAGE_SYNCED_KEY) !== access.user_id) {
      setLanguage(access.preferred_language);
      writeLocal(LANGUAGE_SYNCED_KEY, access.user_id);
    }
  }, [access.user_id, access.preferred_language]);
}

function ShellHeader({ access }: { access: Access | null }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-header pt-[env(safe-area-inset-top)] shadow-lg shadow-black/20 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center gap-3">
        <Link
          to="/app"
          aria-label={t('app.home')}
          className="inline-flex items-center gap-2.5 rounded-lg"
        >
          <LogoMark />
          <span
            className="hidden text-2xl leading-none tracking-tight text-fg sm:inline"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('common.appName')}
          </span>
        </Link>
        {access ? <WorkspaceSwitcher access={access} /> : null}
        <div className="ml-auto flex items-center gap-2">
          <ConnectivityIndicator />
          {access ? <SyncIndicator /> : null}
          <InstallButton compact />
          <LanguageSwitch variant="glass" />
          {access ? <AccountMenu /> : null}
        </div>
      </div>
    </header>
  );
}

function SignOutButton() {
  const { t } = useTranslation();
  const handleSignOut = useSignOut();
  return (
    <Button
      variant="secondary"
      onClick={() => void handleSignOut()}
      leadingIcon={<LogOut aria-hidden="true" />}
    >
      {t('app.signOut')}
    </Button>
  );
}

/** The application name as the tab title, for the shell's own states (pages set their own). */
function ShellTitle() {
  useDocumentTitle();
  return null;
}

function ShellFrame({ access, children }: { access: Access | null; children: ReactNode }) {
  return (
    <div className="night-backdrop relative flex min-h-dvh flex-col overflow-x-clip">
      <EducationBackdrop />
      <ShellHeader access={access} />
      {access && getEnv().demoWorkspaceEnabled ? (
        <div className="relative z-10">
          <DemoBanner userId={access.user_id} />
        </div>
      ) : null}
      <main
        id="main-content"
        tabIndex={-1}
        className="page-enter relative z-10 flex-1 pb-20 outline-none"
      >
        {children}
      </main>
    </div>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const session = useStore(sessionStore);
  const accessQuery = useAccess();
  const location = useLocation();
  const isOnline = useOnlineStatus();

  if (session.status === 'signed-out') {
    return <ToSignIn />;
  }

  // A request that is paused because the device is offline is shown as the offline state below,
  // so that the person can still sign out instead of waiting on a loading screen.
  if (accessQuery.isPending && accessQuery.fetchStatus !== 'paused') {
    return (
      <ShellFrame access={null}>
        <ShellTitle />
        <div
          className="container-page space-y-4 py-8"
          aria-busy="true"
          aria-label={t('app.loading')}
        >
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </ShellFrame>
    );
  }

  // A failed refresh keeps the access already known, so that a dropped network does not close the
  // page the person is working on.
  if ((accessQuery.isError && accessQuery.data === undefined) || accessQuery.isPending) {
    return (
      <ShellFrame access={null}>
        <ShellTitle />
        <StatusPage
          icon={isOnline ? CircleSlash : WifiOff}
          title={isOnline ? t('app.accessError.title') : t('app.accessOffline.title')}
          body={isOnline ? t('app.accessError.body') : t('app.accessOffline.body')}
          actions={
            <>
              <Button
                onClick={() => void accessQuery.refetch()}
                leadingIcon={<RotateCcw aria-hidden="true" />}
                isLoading={accessQuery.isFetching}
              >
                {t('errorBoundary.retry')}
              </Button>
              <SignOutButton />
            </>
          }
        />
      </ShellFrame>
    );
  }

  const access = accessQuery.data;

  if (access?.is_active === false) {
    return (
      <ShellFrame access={null}>
        <ShellTitle />
        <StatusPage
          icon={UserX}
          title={t('app.deactivated.title')}
          body={t('app.deactivated.body')}
          actions={<SignOutButton />}
        />
      </ShellFrame>
    );
  }

  if (!access || workspacesOf(access).length === 0) {
    return (
      <ShellFrame access={null}>
        <ShellTitle />
        <StatusPage
          icon={UserX}
          title={t('app.notProvisioned.title')}
          body={t('app.notProvisioned.body')}
          actions={<SignOutButton />}
        />
      </ShellFrame>
    );
  }

  if (access.password_change_required && location.pathname !== '/app/change-password') {
    return <Navigate to="/app/change-password" replace />;
  }

  return (
    <AccessContext value={access}>
      <ProfileLanguage access={access} />
      <ShellFrame access={access}>
        <Outlet />
      </ShellFrame>
      <TutorLauncher access={access} />
    </AccessContext>
  );
}

function ProfileLanguage({ access }: { access: Access }) {
  useProfileLanguageOnFirstUse(access);
  return null;
}
