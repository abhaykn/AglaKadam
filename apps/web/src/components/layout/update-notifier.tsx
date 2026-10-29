import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { applyServiceWorkerUpdate, updateStore } from '@/features/pwa/service-worker';
import { useStore } from '@/lib/store';

const UPDATE_TOAST_ID = 'app-update';

/**
 * Offers a reload when a new version has been downloaded in the background, and asks for one when
 * this page has fallen behind the version in use. The message stays until the person acts on it.
 */
export function UpdateNotifier() {
  const { t } = useTranslation();
  const state = useStore(updateStore);

  useEffect(() => {
    if (state === 'available') {
      toast(t('common.updateAvailable'), {
        id: UPDATE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        action: { label: t('common.reload'), onClick: () => applyServiceWorkerUpdate() },
      });
    } else if (state === 'reload-needed') {
      toast(t('common.updateReloadNeeded'), {
        id: UPDATE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        action: { label: t('common.reload'), onClick: () => window.location.reload() },
      });
    }
  }, [state, t]);

  return null;
}
