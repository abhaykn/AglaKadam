/** Names shared by the pages and the service worker for sending waiting changes. */

/** Tag of the one-off Background Sync registration that sends waiting changes. */
export const OUTBOX_SYNC_TAG = 'agla-kadam-outbox';

/** Message the service worker posts to an open window instead of sending changes itself. */
export const FLUSH_MESSAGE = 'agla-kadam:flush-outbox';

/** Held while changes are sent, by a page or by the service worker, so only one sends at a time. */
export const SYNC_LOCK = 'agla-kadam-sync';

/** How long the service worker waits for a page that is already sending before trying later. */
export const WORKER_LOCK_WAIT_MS = 60_000;
