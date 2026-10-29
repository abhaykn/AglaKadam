/**
 * Encryption of everything the application keeps on the device.
 *
 * Each signed-in person gets a random AES-GCM key (256 bits) made by the browser as
 * non-extractable: scripts can use it to encrypt and decrypt but can never read its value. Every
 * record is encrypted with a fresh 96-bit IV, and bound with additional authenticated data to the
 * owner, the store and the record id, so a record copied into another place or another person's
 * area fails to decrypt instead of being accepted.
 *
 * What this protects: nothing is stored as readable text; other sites and apps cannot read it; and
 * deleting the key on sign-out leaves anything that remains (for example in storage the browser has
 * not yet compacted) unreadable. What it does not protect against: someone using the same
 * unlocked browser profile, who can use the key through the browser just as the application does,
 * until the person signs out (which deletes it). Locking the phone remains the protection there.
 */

export interface SealedValue {
  /** Format version, so that the layout can change without misreading older records. */
  v: 1;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function additionalData(context: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(context);
}

export async function sealBytes(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
  context: string,
): Promise<SealedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(context) },
    key,
    bytes,
  );
  return { v: 1, iv, data };
}

export async function openBytes(
  key: CryptoKey,
  sealed: SealedValue,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv, additionalData: additionalData(context) },
    key,
    sealed.data,
  );
  return new Uint8Array(plain);
}

/** Encrypts any JSON-compatible value. */
export function sealJson(key: CryptoKey, value: unknown, context: string): Promise<SealedValue> {
  return sealBytes(key, encoder.encode(JSON.stringify(value)), context);
}

export async function openJson<T>(
  key: CryptoKey,
  sealed: SealedValue,
  context: string,
): Promise<T> {
  return JSON.parse(decoder.decode(await openBytes(key, sealed, context))) as T;
}
