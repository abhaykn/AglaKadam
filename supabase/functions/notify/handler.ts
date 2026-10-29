import { failure, type HandlerResult, ok } from '../_shared/http.ts';
import type { NotifyKind, NotifyServices } from '../_shared/services.ts';
import type { PushOutcome, PushTarget, VapidSigner } from '../_shared/web-push.ts';
import { messageFor, type PushMessage } from './messages.ts';

export type Sender = (
  target: PushTarget,
  message: PushMessage,
  signer: VapidSigner,
  options: { ttlSeconds: number; topic: string },
) => Promise<PushOutcome>;

/** Messages sent at once; the push services answer quickly, but not instantly. */
export const PARALLEL_SENDS = 8;

const KINDS: readonly NotifyKind[] = ['plan_ready', 'daily'];

/**
 * Sends the notifications of one kind, or tells a browser the key to subscribe with.
 *
 * `{ "action": "public_key" }` answers the application's public key, which is not secret, to anyone.
 * `{ "kind": ... }` sends the notifications due today; only the database's schedule may ask, with
 * the job token from Vault. Subscriptions the push service no longer knows are forgotten, after
 * each group of messages, so that a run cut short keeps what it learnt.
 *
 * `signer` is null when the keys are not set, and rejects when they are set but not valid.
 */
export async function handleNotify(
  token: string | null,
  body: unknown,
  services: NotifyServices,
  signer: Promise<VapidSigner> | null,
  send: Sender,
  today: string,
  log: (message: string) => void = console.error,
): Promise<HandlerResult> {
  const request =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const ready = async (): Promise<VapidSigner | null> => {
    if (!signer) {
      return null;
    }
    try {
      return await signer;
    } catch (error) {
      log(`The push keys are not valid: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  if (request.action === 'public_key') {
    const keys = await ready();
    return keys ? ok({ publicKey: keys.publicKey }) : failure(503, 'not_configured');
  }
  const kind = KINDS.find((entry) => entry === request.kind);
  if (!kind) {
    return failure(400, 'invalid_request', { field: 'kind' });
  }
  if (!token || !(await services.jobTokenIsValid(token))) {
    return failure(403, 'forbidden');
  }
  const keys = await ready();
  if (!keys) {
    return failure(503, 'not_configured');
  }

  const recipients = await services.recipients(kind, today);
  let sent = 0;
  let gone = 0;
  let failed = 0;
  for (let start = 0; start < recipients.length; start += PARALLEL_SENDS) {
    const batch = recipients.slice(start, start + PARALLEL_SENDS);
    const outcomes = await Promise.all(
      batch.map((recipient) => {
        const message = messageFor(recipient);
        return send({ endpoint: recipient.endpoint, keys: recipient.keys }, message, keys, {
          // A Sunday-evening plan is still useful the next morning; a morning reminder is not.
          ttlSeconds: kind === 'plan_ready' ? 14 * 60 * 60 : 8 * 60 * 60,
          topic: message.tag,
        }).catch((): PushOutcome => 'failed');
      }),
    );
    const batchSent: string[] = [];
    const batchGone: string[] = [];
    outcomes.forEach((outcome, index) => {
      const endpoint = batch[index]?.endpoint ?? '';
      if (outcome === 'sent') {
        batchSent.push(endpoint);
      } else if (outcome === 'gone') {
        batchGone.push(endpoint);
      } else {
        failed += 1;
      }
    });
    if (batchSent.length > 0 || batchGone.length > 0) {
      await services.outcome(batchSent, batchGone);
    }
    sent += batchSent.length;
    gone += batchGone.length;
  }
  return ok({ sent, gone, failed });
}
