import { CloudUpload, LoaderCircle, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { syncStatusStore } from '@/features/offline/sync-status';
import { useStore } from '@/lib/store';
import { signingOutStore, signOutConfirmationStore, useFinishSignOut } from './use-sign-out';

/**
 * Covers the screen while signing out: the device's data for the account is removed first, which
 * can take a moment on a slow phone.
 */
export function SigningOutOverlay() {
  const { t } = useTranslation();
  const isSigningOut = useStore(signingOutStore);
  if (!isSigningOut) {
    return null;
  }
  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-canvas/90 backdrop-blur-sm"
    >
      <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="font-medium text-fg">{t('app.signingOut')}</p>
    </div>
  );
}

/** Asks before signing out deletes changes that have not been uploaded yet. */
export function SignOutConfirmation() {
  const { t } = useTranslation();
  const isOpen = useStore(signOutConfirmationStore);
  const pending = useStore(syncStatusStore, (status) => status.pending);
  const failed = useStore(syncStatusStore, (status) => status.failed);
  const phase = useStore(syncStatusStore, (status) => status.phase);
  const isOnline = useOnlineStatus();
  const finish = useFinishSignOut();
  const [isSigningOut, setSigningOut] = useState(false);
  const waiting = pending + failed;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => signOutConfirmationStore.set(open)}>
      <DialogContent
        title={waiting > 0 ? t('signOutGuard.title') : t('signOutGuard.allUploadedTitle')}
        description={
          waiting > 0
            ? t('signOutGuard.body', { count: waiting })
            : t('signOutGuard.allUploadedBody')
        }
      >
        <div className="mt-2 flex flex-col gap-3 sm:flex-row-reverse">
          {waiting > 0 ? (
            <>
              {isOnline && pending > 0 ? (
                <Button
                  onClick={() => void offlineRuntime.flush({ force: true })}
                  isLoading={phase === 'syncing'}
                  leadingIcon={<CloudUpload aria-hidden="true" />}
                >
                  {t('sync.uploadNow')}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => signOutConfirmationStore.set(false)}>
                {t('signOutGuard.stay')}
              </Button>
              <Button
                variant="danger"
                isLoading={isSigningOut}
                onClick={() => {
                  setSigningOut(true);
                  void finish().finally(() => setSigningOut(false));
                }}
                leadingIcon={<LogOut aria-hidden="true" />}
              >
                {t('signOutGuard.signOutAnyway')}
              </Button>
            </>
          ) : (
            <Button
              isLoading={isSigningOut}
              onClick={() => {
                setSigningOut(true);
                void finish().finally(() => setSigningOut(false));
              }}
              leadingIcon={<LogOut aria-hidden="true" />}
            >
              {t('app.signOut')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
