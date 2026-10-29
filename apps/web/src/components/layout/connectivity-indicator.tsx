import { WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';

/** Shows an offline badge and confirms briefly when the connection returns. */
export function ConnectivityIndicator() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      toast.success(t('common.backOnline'), { duration: 2500 });
    }
  }, [isOnline, t]);

  if (isOnline) {
    return null;
  }

  return (
    <Tooltip content={t('common.offlineDescription')}>
      <Badge tone="warning" role="status" tabIndex={0}>
        <WifiOff aria-hidden="true" />
        {t('common.offline')}
      </Badge>
    </Tooltip>
  );
}
