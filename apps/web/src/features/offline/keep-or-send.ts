import { offlineRuntime } from './offline-runtime';

/**
 * Keeps a change on the device to be sent when it can be, or sends it at once where the device
 * cannot keep it (for example in private browsing). Rejects only when it could be neither kept nor
 * sent.
 */
export async function keepOrSend(
  kind: string,
  payload: unknown,
  dedupeKey: string,
  send: () => Promise<unknown>,
): Promise<void> {
  if (offlineRuntime.isAvailable) {
    try {
      await offlineRuntime.enqueue(kind, payload, dedupeKey);
      return;
    } catch {
      // The device cannot keep it: send it now instead.
    }
  }
  await send();
}
