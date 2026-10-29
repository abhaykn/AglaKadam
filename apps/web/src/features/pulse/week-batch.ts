/**
 * Opening a week of drawn children that arrived encrypted.
 *
 * The database encrypts each week's children with a random key of that week (AES-256-CBC, then
 * HMAC-SHA-256 over the IV and the ciphertext; both keys are derived from the week key with
 * HMAC-SHA-256 of "enc" and "mac"). Phones keep the coming weeks; the key arrives when the week
 * opens, or from the CRP's QR code where there is no network. A wrong or altered key or batch fails
 * the check and opens nothing.
 *
 * This module depends on nothing but the Web Crypto API, so that the database tests can use it to
 * check that the database's encryption and this decryption agree.
 */

export interface EncryptedWeek {
  /** Hex, as the Data API returns `bytea` columns (optionally prefixed with `\x`). */
  iv: string;
  ciphertext: string;
  mac: string;
}

export interface WeekChild {
  sampleId: string;
  studentId: string;
  adapted: boolean;
}

export interface OpenedWeek {
  cycleId: string;
  week: number;
  children: WeekChild[];
}

export class WeekKeyError extends Error {
  constructor() {
    super('The key does not open this week.');
    this.name = 'WeekKeyError';
  }
}

/** Bytes of a hex string, with or without the `\x` prefix of Postgres. */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new WeekKeyError();
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const encoder = new TextEncoder();

async function derive(key: Uint8Array<ArrayBuffer>, purpose: 'enc' | 'mac'): Promise<ArrayBuffer> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', hmacKey, encoder.encode(purpose));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseWeek(value: unknown): OpenedWeek {
  if (typeof value !== 'object' || value === null) {
    throw new WeekKeyError();
  }
  const record = value as Record<string, unknown>;
  const children = record.children;
  if (
    record.v !== 1 ||
    typeof record.cycle !== 'string' ||
    !UUID.test(record.cycle) ||
    typeof record.week !== 'number' ||
    !Array.isArray(children)
  ) {
    throw new WeekKeyError();
  }
  return {
    cycleId: record.cycle,
    week: record.week,
    children: children.map((child: unknown) => {
      const entry = (typeof child === 'object' && child !== null ? child : {}) as Record<
        string,
        unknown
      >;
      const sample = entry.sample;
      const student = entry.student;
      if (
        typeof sample !== 'string' ||
        !UUID.test(sample) ||
        typeof student !== 'string' ||
        !UUID.test(student)
      ) {
        throw new WeekKeyError();
      }
      return { sampleId: sample, studentId: student, adapted: entry.adapted === true };
    }),
  };
}

/** Decrypts a week with its key. Throws `WeekKeyError` when the key or the batch is not genuine. */
export async function openWeek(keyHex: string, week: EncryptedWeek): Promise<OpenedWeek> {
  const key = hexToBytes(keyHex);
  if (key.length !== 32) {
    throw new WeekKeyError();
  }
  const iv = hexToBytes(week.iv);
  const ciphertext = hexToBytes(week.ciphertext);
  const mac = hexToBytes(week.mac);

  const macKey = await crypto.subtle.importKey(
    'raw',
    await derive(key, 'mac'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new Uint8Array(iv.length + ciphertext.length);
  signed.set(iv, 0);
  signed.set(ciphertext, iv.length);
  if (!(await crypto.subtle.verify('HMAC', macKey, mac, signed))) {
    throw new WeekKeyError();
  }

  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    await derive(key, 'enc'),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, encryptionKey, ciphertext);
  } catch {
    throw new WeekKeyError();
  }
  try {
    return parseWeek(JSON.parse(new TextDecoder().decode(plain)) as unknown);
  } catch (error) {
    if (error instanceof WeekKeyError) {
      throw error;
    }
    throw new WeekKeyError();
  }
}

/** The text a CRP's QR code carries to unlock one week of one class. */
export function weekUnlockCode(cycleId: string, week: number, keyHex: string): string {
  const key = keyHex.startsWith('\\x') ? keyHex.slice(2) : keyHex;
  return `AK-PULSE:1:${cycleId}:${String(week)}:${key.toLowerCase()}`;
}

export interface WeekUnlock {
  cycleId: string;
  week: number;
  keyHex: string;
}

/** Reads a scanned QR code; null when it is not a week unlock code. */
export function readWeekUnlockCode(text: string): WeekUnlock | null {
  const match = /^AK-PULSE:1:([0-9a-f-]{36}):([1-4]):([0-9a-f]{64})$/i.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3] || !UUID.test(match[1])) {
    return null;
  }
  return {
    cycleId: match[1].toLowerCase(),
    week: Number(match[2]),
    keyHex: match[3].toLowerCase(),
  };
}
