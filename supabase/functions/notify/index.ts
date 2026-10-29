import { todayInIndia } from '../_shared/accounts.ts';
import { withSupabase } from '../_shared/deps.ts';
import { notifyServices, serve } from '../_shared/platform.ts';
import { sendPush, type VapidSigner, vapidSigner } from '../_shared/web-push.ts';
import { handleNotify } from './handler.ts';

/**
 * The application's push keys, set once as secrets of the project (see the setup guide), checked
 * once for each instance of the function.
 */
function loadSigner(): Promise<VapidSigner> | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')?.trim() ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')?.trim() ?? '';
  const subject = Deno.env.get('VAPID_SUBJECT')?.trim() ?? '';
  return publicKey && privateKey && subject
    ? vapidSigner({ publicKey, privateKey, subject })
    : null;
}

const signer = loadSigner();
// A rejection is reported by the handler when the keys are needed.
signer?.catch(() => undefined);

// Called by the database's schedule with the job token from Vault, and by the application for the
// public key it subscribes with. The platform's JWT check is disabled for this function in
// config.toml.
export default {
  fetch: withSupabase({ auth: 'none' }, (req, ctx) =>
    serve('notify', req, async () =>
      handleNotify(
        req.headers.get('x-job-token'),
        await req.json().catch(() => null),
        notifyServices(ctx.supabaseAdmin),
        signer,
        (target, message, keys, options) => sendPush(target, message, keys, options),
        todayInIndia(),
      ),
    ),
  ),
};
