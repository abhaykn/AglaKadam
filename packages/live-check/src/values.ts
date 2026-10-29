import { randomInt } from 'node:crypto';

const TAG_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';

function pick(alphabet: string, count: number): string {
  let value = '';
  for (let index = 0; index < count; index += 1) {
    value += alphabet.charAt(randomInt(alphabet.length));
  }
  return value;
}

/**
 * Four capital letters that mark every record of one run. The organisation codes built from it
 * (for example `LCKXQPS`) cannot clash with official codes, which are numeric.
 */
export function newRunTag(): string {
  return pick(TAG_LETTERS, 4);
}

/** A ten-digit mobile number in the valid Indian range. No message is ever sent to it. */
export function newMobileNumber(): string {
  return `${randomInt(6, 10)}${pick('0123456789', 9)}`;
}

/** An eleven-digit UDISE-style code with the prefix 99, which no state uses. */
export function newUdiseCode(): string {
  return `99${pick('0123456789', 9)}`;
}

/** A password that meets the project's rules: letters and digits, at least eight characters. */
export function newPassword(length = 16): string {
  return `${pick(PASSWORD_LETTERS, length - 2)}${pick(PASSWORD_DIGITS, 2)}`;
}

/** A six-digit PIN different from `pin`. */
export function differentPin(pin: string): string {
  return String((Number(pin) + 1 + randomInt(1000)) % 1_000_000).padStart(6, '0');
}

/** The Indian academic session (April to March) that contains `date` (YYYY-MM-DD). */
export function academicSessionFor(date: string): {
  label: string;
  startsOn: string;
  endsOn: string;
} {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    startsOn: `${startYear}-04-01`,
    endsOn: `${startYear + 1}-03-31`,
  };
}
