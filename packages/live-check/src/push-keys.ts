/**
 * Creates the application's Web Push keys and stores them as secrets of the linked project, where
 * the `notify` Edge Function reads them.
 *
 *   npm run push:keys
 *
 * The private key is generated here and stored as `secrets.ts` stores every secret: never printed,
 * and on disk only while the Supabase CLI reads it. Running this again replaces the keys: every phone must then turn notifications on again in the account
 * page.
 */
import { generateKeyPairSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { storeSecrets } from './secrets.ts';

export interface PushKeys {
  /** The uncompressed P-256 public key, base64url: 65 bytes starting with 4. */
  publicKey: string;
  /** The private scalar, base64url: 32 bytes. */
  privateKey: string;
}

/** A new key pair in the form browsers and push services use (RFC 8292). */
export function newPushKeys(): PushKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y || !jwk.d) {
    throw new Error('The key pair could not be exported.');
  }
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  return { publicKey: point.toString('base64url'), privateKey: jwk.d };
}

/** The contact push services may write to about the application's messages. */
export function contactOf(answer: string): string | null {
  const email = answer.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : null;
}

/** Asks for a contact, then creates and stores the keys. */
export async function storePushKeys(): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      'This creates the keys for notifications and stores them in the linked Supabase project.\n' +
        'If keys were stored before, they are replaced, and every phone has to turn\n' +
        'notifications on again.\n',
    );
    const subject = contactOf(
      await prompt.question('An email address the push services may write to: '),
    );
    if (!subject) {
      throw new Error('That is not an email address. Nothing was changed.');
    }
    const answer = await prompt.question('Store new keys in the linked project now? (y/N) ');
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Nothing was changed.');
      return;
    }
    const keys = newPushKeys();
    storeSecrets(
      {
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: subject,
      },
      'Interrupted. The keys may not have been stored; run the command again.',
    );
    console.log(
      '\nThe keys are stored. The notify function uses them from now on; nothing to restart.',
    );
  } finally {
    prompt.close();
  }
}
