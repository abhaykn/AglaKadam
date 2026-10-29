import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import {
  disablePush,
  enablePush,
  notificationSettingsQuery,
  NotificationsRefusedError,
  NotificationsUnavailableError,
  pushState,
  saveNotificationSettings,
  type NotificationKind,
  type NotificationSettings,
  type PushState,
} from './push';

/** Which kinds of notification apply to someone, from their roles. */
function kindsFor(roles: Set<string>): NotificationKind[] {
  const kinds: NotificationKind[] = [];
  if (roles.has('crp')) {
    kinds.push('plan_ready');
  }
  if (roles.has('crp') || roles.has('teacher')) {
    kinds.push('check_back');
  }
  if (roles.has('teacher')) {
    kinds.push('pulse_week');
  }
  return kinds;
}

/** Notifications on this phone, and the kinds the person wants. */
export function NotificationsCard() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const kinds = kindsFor(new Set(access.assignments.map((assignment) => assignment.role)));
  const [state, setState] = useState<PushState | null>(null);
  const settings = useQuery({ ...notificationSettingsQuery(), enabled: kinds.length > 0 });

  useEffect(() => {
    let active = true;
    void pushState().then((current) => {
      if (active) {
        setState(current);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) {
        await enablePush();
      } else {
        await disablePush();
      }
      return pushState();
    },
    onSuccess: (current) => setState(current),
    onError: async (error) => {
      setState(await pushState());
      toast.error(
        error instanceof NotificationsRefusedError
          ? t('notifications.refused')
          : error instanceof NotificationsUnavailableError
            ? t('notifications.unsupported')
            : t('notifications.failed'),
      );
    },
  });

  const change = useMutation({
    mutationFn: async (next: NotificationSettings) => {
      await saveNotificationSettings(access.user_id, next);
      return next;
    },
    onSuccess: (next) => queryClient.setQueryData(notificationSettingsQuery().queryKey, next),
    onError: () => toast.error(t('notifications.failed')),
  });

  if (kinds.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader title={t('notifications.title')} description={t('notifications.body')} />
      <CardBody className="space-y-4">
        {state === 'unsupported' ? (
          <Alert tone="info">{t('notifications.unsupported')}</Alert>
        ) : state === 'denied' ? (
          <Alert tone="warning">{t('notifications.blocked')}</Alert>
        ) : state === null ? null : (
          <Button
            variant={state === 'on' ? 'secondary' : 'primary'}
            disabled={toggle.isPending || !isOnline}
            onClick={() => toggle.mutate(state !== 'on')}
          >
            {toggle.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : state === 'on' ? (
              <BellOff aria-hidden="true" />
            ) : (
              <Bell aria-hidden="true" />
            )}
            {state === 'on' ? t('notifications.turnOff') : t('notifications.turnOn')}
          </Button>
        )}
        {!isOnline ? (
          <p className="text-sm text-fg-muted">{t('notifications.needsNetwork')}</p>
        ) : null}
        {state === 'on' && settings.data ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">{t('notifications.kindsLabel')}</legend>
            {kinds.map((kind) => (
              <label
                key={kind}
                className="flex min-h-12 items-start gap-3 rounded-lg border border-border px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={settings.data[kind]}
                  disabled={change.isPending || !isOnline}
                  onChange={(event) =>
                    change.mutate({ ...settings.data, [kind]: event.target.checked })
                  }
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-fg">
                    {t(`notifications.kind.${kind}.title`)}
                  </span>
                  <span className="block text-sm text-fg-muted">
                    {t(`notifications.kind.${kind}.body`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </CardBody>
    </Card>
  );
}
