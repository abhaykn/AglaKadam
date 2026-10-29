/**
 * Sign-in identifiers and credential rules shared by the Edge Functions and the web application.
 *
 * The module is runtime-neutral: it depends only on the Web Crypto API, which browsers, Deno and
 * Node all provide, so both sides apply exactly the same rules.
 */

/**
 * Sign-in identities use domains under the reserved `.invalid` top-level domain (RFC 2606). No
 * message can ever be delivered to them, so the platform never emails anyone on behalf of these
 * accounts, and the domains can never be registered by a third party.
 */
const STAFF_EMAIL_DOMAIN = 'staff.agla-kadam.invalid';
export const FAMILY_EMAIL_DOMAIN = 'family.agla-kadam.invalid';
/** Accounts of demonstration districts, created and removed by the `demo` function. */
export const DEMO_EMAIL_DOMAIN = 'demo.agla-kadam.invalid';

export const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
export const LEARNER_CODE_PATTERN = /^[1-9][0-9]{9}$/;
export const PIN_PATTERN = /^[0-9]{6}$/;

export const PASSWORD_MIN_LENGTH = 8;
/** The Auth service hashes passwords with bcrypt, which ignores everything after 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Indian mobile number in its 10-digit form, accepting common ways of writing it: spaces, dashes,
 * a leading 0, or the +91 / 91 country code. Returns null when the input is not a mobile number.
 */
export function normaliseMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return MOBILE_PATTERN.test(digits) ? digits : null;
}

export function staffEmailForMobile(mobile: string): string {
  if (!MOBILE_PATTERN.test(mobile)) {
    throw new Error('A staff sign-in identity requires a 10-digit mobile number.');
  }
  return `m${mobile}@${STAFF_EMAIL_DOMAIN}`;
}

export function familyEmailForLearnerCode(learnerCode: string): string {
  if (!isValidLearnerCode(learnerCode)) {
    throw new Error('A family sign-in identity requires a valid learner code.');
  }
  return `f${learnerCode}@${FAMILY_EMAIL_DOMAIN}`;
}

/** True for a 10-digit learner code whose last digit is a valid Luhn check digit. */
export function isValidLearnerCode(code: string): boolean {
  if (!LEARNER_CODE_PATTERN.test(code)) {
    return false;
  }
  let total = 0;
  for (let index = 0; index < code.length; index += 1) {
    let digit = Number(code[code.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    total += digit;
  }
  return total % 10 === 0;
}

export type PasswordIssue =
  'too_short' | 'too_long' | 'needs_letter' | 'needs_digit' | 'contains_mobile';

/** Problems that prevent a password from being accepted; an empty list means it is acceptable. */
export function passwordIssues(password: string, mobile?: string | null): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push('too_short');
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    issues.push('too_long');
  }
  if (!/\p{L}/u.test(password)) {
    issues.push('needs_letter');
  }
  if (!/[0-9]/.test(password)) {
    issues.push('needs_digit');
  }
  if (mobile && password.includes(mobile)) {
    issues.push('contains_mobile');
  }
  return issues;
}

/** Uniformly distributed integer in [0, upperBound), using rejection sampling to avoid bias. */
function randomInt(upperBound: number): number {
  const limit = Math.floor(0x1_0000_0000 / upperBound) * upperBound;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? 0;
    if (value < limit) {
      return value % upperBound;
    }
  }
}

function randomString(alphabet: string, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += alphabet[randomInt(alphabet.length)];
  }
  return result;
}

/** Letters and digits that cannot be confused with one another when read from paper. */
const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Temporary password handed to a staff member on paper: ten characters without look-alikes such
 * as 0/O and 1/l/I, always containing at least one letter and one digit.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    const candidate = randomString(UNAMBIGUOUS_ALPHABET, 10);
    if (/[A-Za-z]/.test(candidate) && /[0-9]/.test(candidate)) {
      return candidate;
    }
  }
}

/**
 * Random password for an account that never signs in with a password (family accounts sign in
 * with a learner code and PIN). It is never shown to anyone.
 */
export function generateUnusablePassword(): string {
  return `${randomString(UNAMBIGUOUS_ALPHABET, 46)}a1`;
}

/** True for PINs that are easy to guess: few distinct digits or a straight run such as 123456. */
export function isWeakPin(pin: string): boolean {
  if (new Set(pin).size < 3) {
    return true;
  }
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - (digits[index] ?? 0));
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

/** Six-digit family PIN that is not trivially guessable. */
export function generatePin(): string {
  for (;;) {
    const candidate = randomString('0123456789', 6);
    if (!isWeakPin(candidate)) {
      return candidate;
    }
  }
}

/** Today's calendar date in India (UTC+05:30) as `YYYY-MM-DD`. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
