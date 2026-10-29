import { createStore } from '@/lib/store';

/**
 * - `unavailable`: this browser cannot keep data on the device (storage blocked); changes need a
 *   connection and are sent straight away.
 * - `offline`: changes are kept and will be sent when the network returns.
 * - `syncing`: changes are being sent now.
 * - `idle`: nothing is being sent; `pending` and `failed` say what is still on the device.
 */
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'unavailable';

export interface SyncStatus {
  phase: SyncPhase;
  /** Changes waiting to be sent, including those waiting for a retry. */
  pending: number;
  /** Changes the server refused; they stay on the device until retried or discarded. */
  failed: number;
  lastSyncedAt: number | null;
  /** Increases whenever the waiting changes change, so views can read them again. */
  revision: number;
  /** Why the device could not keep data (the browser's own error), when the phase is `unavailable`. */
  problem: string | null;
}

export const initialSyncStatus: SyncStatus = {
  phase: 'idle',
  pending: 0,
  failed: 0,
  lastSyncedAt: null,
  revision: 0,
  problem: null,
};

export const syncStatusStore = createStore<SyncStatus>(initialSyncStatus);
