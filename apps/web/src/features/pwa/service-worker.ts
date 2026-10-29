import { Workbox } from 'workbox-window';
import { createStore } from '@/lib/store';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** How long to wait for the new version to take over after the user accepts it before reloading. */
const UPDATE_RELOAD_FALLBACK_MS = 10_000;

/**
 * `available`: a new version has been downloaded and waits until the user accepts it.
 * `reload-needed`: this page runs older code than the version now in charge, because the update was
 * accepted in another window or a part of the application could not be loaded; it should reload.
 */
export type UpdateState = 'none' | 'available' | 'reload-needed';

export const updateStore = createStore<UpdateState>('none');

/**
 * Whether `error` is a part of the application that could not be loaded. After a new version is
 * published, the files of the version this page runs are gone; trying again cannot help, while
 * loading the page afresh brings the new version.
 */
export function isStaleCodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|importing a module script failed|unable to preload css/i.test(
    message,
  );
}

let workbox: Workbox | null = null;
let registration: ServiceWorkerRegistration | undefined;
let updateRequested = false;

/**
 * Registers the service worker in production builds. New versions wait until the user accepts
 * the update so that an in-progress recording or form is never interrupted by a reload: only the
 * window where the update was accepted reloads; other open windows are asked to reload instead.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }

  // A part of the application that cannot be loaded usually belongs to a version that has been
  // replaced; the route shows its own error, and the person is offered a reload.
  window.addEventListener('vite:preloadError', () => {
    updateStore.set('reload-needed');
  });

  const wasControlled = navigator.serviceWorker.controller !== null;
  let updateSeen = false;

  workbox = new Workbox('/sw.js', { scope: '/', type: 'classic' });

  workbox.addEventListener('waiting', () => {
    updateSeen = true;
    if (updateStore.get() === 'none') {
      updateStore.set('available');
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) {
      window.location.reload();
      return;
    }
    // The first installation taking control changes nothing for this page. A newer version taking
    // control (accepted in another window) means this page's code is out of date.
    if (wasControlled || updateSeen) {
      updateStore.set('reload-needed');
    }
  });

  workbox
    .register()
    .then((registered) => {
      registration = registered;
      if (!registered) {
        return;
      }
      const checkForUpdate = (): void => {
        if (navigator.onLine) {
          // A failed update check is harmless: the current version keeps working offline.
          registered.update().catch(() => undefined);
        }
      };
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });
    })
    .catch((error: unknown) => {
      // Registration can be refused by private browsing modes, enterprise policies or embedded
      // browsers. The application still works online; only offline support is unavailable.
      console.warn(
        'Offline support is unavailable: the service worker could not be registered.',
        error,
      );
    });
}

/**
 * Activates the waiting version; this page reloads once it takes control. If nothing is waiting
 * any more (it was activated from another window), or it does not take over in time, the page
 * reloads directly.
 */
export function applyServiceWorkerUpdate(): void {
  updateRequested = true;
  if (workbox && registration?.waiting) {
    workbox.messageSkipWaiting();
    window.setTimeout(() => window.location.reload(), UPDATE_RELOAD_FALLBACK_MS);
  } else {
    window.location.reload();
  }
}
