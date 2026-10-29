/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { FLUSH_MESSAGE, OUTBOX_SYNC_TAG } from './features/offline/sync-constants';
import { sendFromWorker } from './features/offline/worker-sync';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (PrecacheEntry | string)[];
};

/*
 * The application shell, fonts and route chunks are precached at install time, so the app opens
 * instantly and fully offline after the first visit.
 */
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/*
 * Every in-app navigation resolves to the precached shell. Requests for files and for API paths
 * are excluded so they are never answered with HTML.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /\/[^/?]+\.[^/]+$/],
  }),
);

/* Same-origin images added after the build (for example teacher learning material thumbnails). */
registerRoute(
  ({ request, url }) => request.destination === 'image' && url.origin === self.location.origin,
  new CacheFirst({
    cacheName: 'ak-images',
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'SKIP_WAITING'
  ) {
    void self.skipWaiting();
  }
});

/** A Background Sync event (not yet part of the standard library types). */
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

/*
 * Changes saved on the device while offline are sent once a network is available, even after the
 * application has been closed. An open, visible page sends them itself, so the worker asks it to
 * instead of competing with it.
 */
async function sendWaitingChanges(): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window' });
  const visible = windows.filter((client) => client.visibilityState === 'visible');
  if (visible.length > 0) {
    for (const client of visible) {
      client.postMessage({ type: FLUSH_MESSAGE });
    }
    return;
  }
  await sendFromWorker();
}

self.addEventListener('sync', (event) => {
  const sync = event as SyncEvent;
  if (sync.tag === OUTBOX_SYNC_TAG) {
    sync.waitUntil(sendWaitingChanges());
  }
});

/*
 * Notifications sent by the `notify` Edge Function. Each says what is due and opens the page where
 * it can be done; a message with the same tag replaces the earlier one.
 */
interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

function messageOf(data: PushMessageData | null): PushMessage | null {
  try {
    const value: unknown = data?.json();
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const { title, body, url, tag } = value as Record<string, unknown>;
    if (typeof title !== 'string' || typeof body !== 'string') {
      return null;
    }
    // Only pages of this application are opened.
    const page = typeof url === 'string' && url.startsWith('/app') ? url : '/app';
    return { title, body, url: page, tag: typeof tag === 'string' ? tag : 'agla-kadam' };
  } catch {
    return null;
  }
}

self.addEventListener('push', (event: PushEvent) => {
  const message = messageOf(event.data);
  if (!message) {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icons/icon-192.png',
      badge: '/favicon-32.png',
      data: { url: message.url },
    }),
  );
});

async function openPage(url: string): Promise<void> {
  const target = new URL(url, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => client.url.startsWith(self.location.origin));
  if (open) {
    await open.focus();
    await open.navigate(target).catch(() => undefined);
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const url =
    typeof data === 'object' && data !== null && typeof (data as { url?: unknown }).url === 'string'
      ? (data as { url: string }).url
      : '/app';
  event.waitUntil(openPage(url));
});

clientsClaim();
