/**
 * Web Push without a third-party service: messages encrypted for the browser's push service as
 * RFC 8291 describes (aes128gcm content coding, RFC 8188), and requests identified with a VAPID
 * signature (RFC 8292). Only the Web Crypto API is used, so the same code runs in the Edge Function
 * and in the tests.
 */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(parts.reduce((sum, part) => sum + part.length, 0)));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

/** HKDF with SHA-256, for an output of at most 32 bytes (one block). */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  material: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const pseudoRandom = await hmac(salt, material);
  const block = await hmac(pseudoRandom, concat(info, new Uint8Array([1])));
  return block.slice(0, length);
}

/** An uncompressed P-256 public key (65 bytes) and its private scalar (32 bytes) as a JWK. */
function jwkOf(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    throw new Error('A P-256 public key in uncompressed form is 65 bytes starting with 4.');
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33, 65)),
    ...(privateKey ? { d: toBase64Url(privateKey) } : {}),
    ext: true,
  };
}

export interface PushSubscriptionKeys {
  /** The browser's public key for the subscription (`p256dh`), base64url. */
  p256dh: string;
  /** The subscription's authentication secret, base64url. */
  auth: string;
}

/** For the tests only: a fixed salt and key pair in place of fresh random ones. */
export interface EncryptionFixture {
  salt: Uint8Array<ArrayBuffer>;
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: Uint8Array<ArrayBuffer>;
}

/** Record size announced in the header; one record holds any message the app sends. */
const RECORD_SIZE = 4096;

/**
 * Encrypts a message for one subscription (RFC 8291). The result is the request body, sent with
 * `Content-Encoding: aes128gcm`.
 */
export async function encryptMessage(
  keys: PushSubscriptionKeys,
  message: Uint8Array<ArrayBuffer>,
  fixture?: EncryptionFixture,
): Promise<Uint8Array<ArrayBuffer>> {
  const userAgentPublic = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);
  if (message.length > RECORD_SIZE - 17 - 86) {
    throw new Error('The message is too long for one push record.');
  }

  let serverPublic: Uint8Array<ArrayBuffer>;
  let serverPrivate: CryptoKey;
  if (fixture) {
    serverPublic = fixture.publicKey;
    serverPrivate = await crypto.subtle.importKey(
      'jwk',
      jwkOf(fixture.publicKey, fixture.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    serverPrivate = pair.privateKey;
  }
  const userAgentKey = await crypto.subtle.importKey(
    'jwk',
    jwkOf(userAgentPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: userAgentKey }, serverPrivate, 256),
  );

  const keyInfo = concat(
    encoder.encode('WebPush: info'),
    new Uint8Array([0]),
    userAgentPublic,
    serverPublic,
  );
  const inputKeyMaterial = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = fixture?.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const contentKey = await hkdf(
    salt,
    inputKeyMaterial,
    concat(encoder.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    salt,
    inputKeyMaterial,
    concat(encoder.encode('Content-Encoding: nonce'), new Uint8Array([0])),
    12,
  );

  // A single record, so it ends with the last-record delimiter and needs no padding.
  const record = concat(message, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record),
  );

  const header = new Uint8Array(new ArrayBuffer(21));
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPublic.length;
  return concat(header, serverPublic, encrypted);
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (as given to browsers when they subscribe). */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
  /** A contact for the push services: `mailto:` address or `https:` URL. */
  subject: string;
}

/** Signs the application's identity for each push service (RFC 8292). */
export interface VapidSigner {
  publicKey: string;
  /** The `Authorization` header for a request to this endpoint. */
  authorization(endpoint: string, now?: number): Promise<string>;
}

/** How long a signed token is valid; push services accept at most 24 hours. */
const TOKEN_HOURS = 12;
/** A token is signed again when less than this is left of it. */
const TOKEN_RENEW_MS = 60 * 60 * 1000;

/**
 * Checks the application's keys and returns a signer for them. Throws when the keys are not a
 * matching P-256 pair or the contact is neither a `mailto:` address nor an `https:` URL, so that a
 * wrong secret is noticed once rather than on every message. A token is reused for each push
 * service while it has more than an hour left.
 */
export async function vapidSigner(keys: VapidKeys): Promise<VapidSigner> {
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(keys.subject)) {
    throw new Error('The push contact must be a mailto: address or an https: URL.');
  }
  const publicBytes = fromBase64Url(keys.publicKey);
  const privateBytes = fromBase64Url(keys.privateKey);
  if (privateBytes.length !== 32) {
    throw new Error('The private push key is 32 bytes.');
  }
  const mismatch = 'The push keys are not a matching P-256 pair.';
  const signingKey = await crypto.subtle
    .importKey(
      'jwk',
      jwkOf(publicBytes, privateBytes),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    .catch(() => {
      throw new Error(mismatch);
    });
  const verifyingKey = await crypto.subtle.importKey(
    'jwk',
    jwkOf(publicBytes),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const sign = async (text: string) =>
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKey,
        encoder.encode(text),
      ),
    );
  // The private key must belong to the public key that browsers subscribe with.
  const probe = 'agla-kadam push key check';
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyingKey,
      await sign(probe),
      encoder.encode(probe),
    ))
  ) {
    throw new Error(mismatch);
  }

  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const signed = new Map<string, { value: string; expiresAt: number }>();
  return {
    publicKey: keys.publicKey,
    async authorization(endpoint, now = Date.now()) {
      const audience = new URL(endpoint).origin;
      const held = signed.get(audience);
      if (held && held.expiresAt - now > TOKEN_RENEW_MS) {
        return held.value;
      }
      const expiresAt = (Math.floor(now / 1000) + TOKEN_HOURS * 60 * 60) * 1000;
      const claims = toBase64Url(
        encoder.encode(JSON.stringify({ aud: audience, exp: expiresAt / 1000, sub: keys.subject })),
      );
      const unsigned = `${header}.${claims}`;
      // Web Crypto returns the signature as r followed by s, which is what ES256 needs.
      const value = `vapid t=${unsigned}.${toBase64Url(await sign(unsigned))}, k=${keys.publicKey}`;
      signed.set(audience, { value, expiresAt });
      return value;
    },
  };
}

/** The `Authorization` header that identifies the application to the push service (RFC 8292). */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now: number = Date.now(),
): Promise<string> {
  return (await vapidSigner(keys)).authorization(endpoint, now);
}

/**
 * The push services of the common browsers: Chrome, Edge on Android, Samsung Internet and Opera
 * (Firebase), Firefox (Mozilla), Safari (Apple) and Edge on Windows. The database keeps no other
 * endpoint; the check here keeps the function from calling any other address all the same.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isPushService(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export interface PushTarget {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** A push service that has not answered by then is counted as failed for this message. */
export const SEND_TIMEOUT_MS = 10_000;

/**
 * Sends one message. `gone` means the subscription no longer exists (the person unsubscribed or
 * the browser dropped it) and should be forgotten. A redirect is not followed.
 */
export async function sendPush(
  target: PushTarget,
  message: unknown,
  signer: VapidSigner,
  options: { ttlSeconds?: number; urgency?: 'low' | 'normal' | 'high'; topic?: string } = {},
  fetcher: typeof fetch = fetch,
): Promise<PushOutcome> {
  if (!isPushService(target.endpoint)) {
    return 'failed';
  }
  const body = await encryptMessage(target.keys, encoder.encode(JSON.stringify(message)));
  const response = await fetcher(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await signer.authorization(target.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttlSeconds ?? 12 * 60 * 60),
      Urgency: options.urgency ?? 'normal',
      ...(options.topic ? { Topic: options.topic } : {}),
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) {
    return 'gone';
  }
  return response.status >= 200 && response.status < 300 ? 'sent' : 'failed';
}
