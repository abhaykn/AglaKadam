import {
  CircleAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  LockKeyhole,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';
import { changeHandler } from './change-registry';
import { offlineRuntime, type WaitingChange } from './offline-runtime';
import { formatBytes, formatTimestamp, reasonFor, relativeTime } from './sync-reasons';
import { syncStatusStore } from './sync-status';

function useWaitingChanges(isOpen: boolean): WaitingChange[] {
  const { t, i18n } = useTranslation();
  const revision = useStore(syncStatusStore, (status) => status.revision);
  const [changes, setChanges] = useState<WaitingChange[]>([]);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let active = true;
    offlineRuntime
      .waitingChanges((kind, payload) => {
        const handler = changeHandler(kind);
        const parsed = handler?.schema.safeParse(payload);
        return handler && parsed?.success ? handler.describe(parsed.data, t, i18n.language) : null;
      })
      .then((list) => {
        if (active) {
          setChanges(list);
        }
      })
      .catch(() => {
        if (active) {
          setChanges([]);
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, revision, t, i18n.language]);
  return changes;
}

function useStorageEstimate(isOpen: boolean): { usage: number; persisted: boolean } | null {
  const [estimate, setEstimate] = useState<{ usage: number; persisted: boolean } | null>(null);
  useEffect(() => {
    if (!isOpen || !('storage' in navigator)) {
      return;
    }
    let active = true;
    void Promise.all([navigator.storage.estimate(), navigator.storage.persisted()])
      .then(([value, persisted]) => {
        if (active) {
          setEstimate({ usage: value.usage ?? 0, persisted });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isOpen]);
  return estimate;
}

function ChangeRow({ change }: { change: WaitingChange }) {
  const { t, i18n } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isFailed = change.state === 'failed';
  const isWaitingForRetry = !isFailed && change.lastError !== null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-fg">
            {change.description ?? t('sync.reasons.unreadable')}
          </p>
          <p className="text-sm text-fg-muted">
            {t('sync.savedAt', { time: formatTimestamp(change.createdAt, i18n.language) })}
          </p>
        </div>
        <Badge tone={isFailed ? 'danger' : 'warning'}>
          {isFailed ? t('sync.state.failed') : t('sync.state.waiting')}
        </Badge>
      </div>
      {isFailed && change.lastError ? (
        <p className="text-sm text-danger">{reasonFor(change.lastError, t)}</p>
      ) : null}
      {isWaitingForRetry && change.lastError ? (
        <p className="text-sm text-fg-muted">
          {t('sync.retrying', {
            reason: reasonFor(change.lastError, t),
            time: relativeTime(change.nextAttemptAt, i18n.language),
          })}
        </p>
      ) : null}
      {confirmingDelete ? (
        <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-soft p-3">
          <p className="text-sm text-fg">{t('sync.discardConfirm')}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                offlineRuntime.discard(change.id).catch(() => toast.error(t('sync.actionFailed')));
              }}
            >
              {t('sync.discard')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmingDelete(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {isFailed || isWaitingForRetry ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                offlineRuntime.retry(change.id).catch(() => toast.error(t('sync.actionFailed')));
              }}
              leadingIcon={<RotateCcw aria-hidden="true" />}
            >
              {t('sync.retry')}
            </Button>
          ) : null}
          {isFailed ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              leadingIcon={<Trash2 aria-hidden="true" />}
            >
              {t('sync.discard')}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** The list of changes kept on this device, with what is happening to each. */
function SyncCenterContent({ isOpen }: { isOpen: boolean }) {
  const { t, i18n } = useTranslation();
  const status = useStore(syncStatusStore);
  const isOnline = useOnlineStatus();
  const changes = useWaitingChanges(isOpen);
  const storage = useStorageEstimate(isOpen);

  if (status.phase === 'unavailable') {
    return (
      <Alert tone="warning">
        <p>{t('sync.unavailable')}</p>
        {status.problem ? (
          <p className="mt-2 text-xs break-words opacity-80">
            {t('sync.problem')}: {status.problem}
          </p>
        ) : null}
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Alert tone={isOnline ? 'info' : 'warning'}>
        {isOnline ? t('sync.onlineHint') : t('sync.offlineHint')}
      </Alert>
      {changes.length === 0 ? (
        <p className="flex items-center gap-2 text-fg">
          <CloudCheck className="size-5 text-success" aria-hidden="true" />
          {t('sync.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {changes.map((change) => (
            <ChangeRow key={change.id} change={change} />
          ))}
        </ul>
      )}
      {isOnline && status.pending > 0 ? (
        <Button
          className="w-full"
          onClick={() => void offlineRuntime.flush({ force: true })}
          isLoading={status.phase === 'syncing'}
          leadingIcon={<CloudUpload aria-hidden="true" />}
        >
          {t('sync.uploadNow')}
        </Button>
      ) : null}
      <div className="space-y-1.5 border-t border-border pt-4 text-sm text-fg-muted">
        {status.lastSyncedAt ? (
          <p>
            {t('sync.lastSynced', { time: formatTimestamp(status.lastSyncedAt, i18n.language) })}
          </p>
        ) : null}
        {storage ? (
          <p>
            {t('sync.storageUsed', { size: formatBytes(storage.usage, i18n.language) })}{' '}
            {storage.persisted ? t('sync.storageKept') : t('sync.storageMayBeCleared')}
          </p>
        ) : null}
        <p className="flex items-start gap-1.5">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('sync.privacy')}
        </p>
      </div>
    </div>
  );
}

/**
 * The upload state in the header: everything uploaded, changes waiting, offline, or changes that
 * were not accepted. Opens the list of changes kept on this device.
 */
export function SyncIndicator() {
  const { t } = useTranslation();
  const status = useStore(syncStatusStore);
  const isOnline = useOnlineStatus();
  const [isOpen, setOpen] = useState(false);

  const waiting = status.pending + status.failed;
  const label =
    status.phase === 'unavailable'
      ? t('sync.indicator.unavailable')
      : status.failed > 0
        ? t('sync.indicator.failed', { count: status.failed })
        : status.pending > 0
          ? isOnline
            ? t('sync.indicator.pending', { count: status.pending })
            : t('sync.indicator.offline', { count: status.pending })
          : t('sync.indicator.synced');
  const Icon =
    status.phase === 'unavailable'
      ? CloudOff
      : status.failed > 0
        ? CircleAlert
        : status.pending > 0
          ? CloudUpload
          : CloudCheck;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="relative"
      >
        <Icon
          aria-hidden="true"
          className={cn(
            status.failed > 0 && 'text-danger',
            status.failed === 0 && status.pending > 0 && 'text-warning',
            status.phase === 'syncing' && 'animate-pulse',
          )}
        />
        {waiting > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-4 font-semibold text-primary-fg tabular-nums">
            {waiting > 99 ? '99+' : waiting}
          </span>
        ) : null}
      </Button>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent placement="right" title={t('sync.title')} description={label}>
          <SyncCenterContent isOpen={isOpen} />
        </DialogContent>
      </Dialog>
    </>
  );
}
