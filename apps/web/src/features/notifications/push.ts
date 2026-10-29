import { queryOptions } from '@tanstack/react-query';
import { callFunction } from '@/lib/functions';
import { getSupabase } from '@/lib/supabase';

/**
 * Notifications on this phone through the browser's own push service (Web Push), with the
 * application's public key from the `notify` Edge Function. The person decides in the account page;
 * nothing is asked for on its own.
 */

export type NotificationKind = 'plan_ready' | 'check_back' | 'pulse_week';

export interface NotificationSettings {
  plan_ready: boolean;
  check_back: boolean;
  pulse_week: boolean;
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

/** Whether this browser can receive push notifications at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Whether a subscription was made with this application key. */
function madeWithKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const used = subscription.options.applicationServerKey;
  if (!used) {
    return false;
  }
  const bytes = new Uint8Array(used);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** How long signing out waits for the server to forget the phone's subscription. */
const SIGN_OUT_WAIT_MS = 5_000;

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Whether notifications reach this phone now. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') {
    return 'denied';
  }
  return Notification.permission === 'granted' && (await currentSubscription()) ? 'on' : 'off';
}

/** Error thrown when the person or the browser does not allow notifications. */
export class NotificationsRefusedError extends Error {
  constructor() {
    super('Notifications were not allowed.');
    this.name = 'NotificationsRefusedError';
  }
}

/**
 * Error thrown when this page has no offline support to receive notifications with: the browser
 * refused to install it (private browsing, a policy) or it is not ready in time.
 */
export class NotificationsUnavailableError extends Error {
  constructor() {
    super('Notifications cannot be received in this browser.');
    this.name = 'NotificationsUnavailableError';
  }
}

/** How long turning notifications on waits for the offline support to become active. */
const READY_WAIT_MS = 10_000;

/** The active service worker registration, without waiting for one that will never come. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    throw new NotificationsUnavailableError();
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new NotificationsUnavailableError()), READY_WAIT_MS),
    ),
  ]);
}

/** Asks for permission, subscribes this phone and keeps the subscription for the account. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new NotificationsRefusedError();
  }
  const registration = await activeRegistration();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new NotificationsRefusedError();
  }
  const { publicKey } = await callFunction<{ publicKey: string }>('notify', {
    action: 'public_key',
  });
  const key = keyBytes(publicKey);
  let existing = await registration.pushManager.getSubscription();
  // A subscription made with keys that were replaced since receives nothing: make a new one.
  if (existing && !madeWithKey(existing, key)) {
    await getSupabase().from('push_subscriptions').delete().eq('endpoint', existing.endpoint);
    await existing.unsubscribe();
    existing = null;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));
  const json = subscription.toJSON();
  const { error } = await getSupabase().rpc('keep_push_subscription', {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth_secret: json.keys?.auth ?? '',
  });
  if (error) {
    throw error;
  }
}

/** Stops notifications on this phone for the account. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) {
    return;
  }
  const { error } = await getSupabase()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', subscription.endpoint);
  if (error) {
    throw error;
  }
  await subscription.unsubscribe();
}

/**
 * When signing out, the phone stops receiving this account's notifications at once. The server is
 * told while the session lasts, but signing out never waits long for it: without a network it
 * forgets the subscription the next time the push service reports it gone.
 */
export async function forgetPushOnSignOut(): Promise<void> {
  // Signing out never waits on the browser's push service longer than on the server.
  await Promise.race([
    forgetSubscription(),
    new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_WAIT_MS)),
  ]);
}

async function forgetSubscription(): Promise<void> {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) {
    return;
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  await getSupabase()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .abortSignal(AbortSignal.timeout(SIGN_OUT_WAIT_MS))
    .then(
      () => undefined,
      () => undefined,
    );
}

export function notificationSettingsQuery() {
  return queryOptions({
    queryKey: ['notification-settings'],
    queryFn: async (): Promise<NotificationSettings> => {
      const { data, error } = await getSupabase()
        .from('notification_settings')
        .select('plan_ready, check_back, pulse_week')
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data ?? { plan_ready: true, check_back: true, pulse_week: true };
    },
  });
}

export async function saveNotificationSettings(
  userId: string,
  settings: NotificationSettings,
): Promise<void> {
  const { error } = await getSupabase()
    .from('notification_settings')
    .upsert({ profile_id: userId, ...settings }, { onConflict: 'profile_id' });
  if (error) {
    throw error;
  }
}
