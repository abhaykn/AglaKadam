import { describe, expect, it } from 'vitest';
import {
  familyEmailForLearnerCode,
  generatePin,
  generateTemporaryPassword,
  generateUnusablePassword,
  isValidLearnerCode,
  isWeakPin,
  normaliseMobile,
  passwordIssues,
  staffEmailForMobile,
  todayInIndia,
} from '../../../supabase/functions/_shared/accounts.ts';

describe('mobile numbers', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
  ])('reads %s as %s', (input, expected) => {
    expect(normaliseMobile(input)).toBe(expected);
  });

  it.each(['5876543210', '987654321', '98765432101', 'abcdefghij', ''])('rejects %s', (input) => {
    expect(normaliseMobile(input)).toBeNull();
  });
});

describe('sign-in identities', () => {
  it('maps a mobile number to a staff identity on a reserved domain', () => {
    expect(staffEmailForMobile('9876543210')).toBe('m9876543210@staff.agla-kadam.invalid');
    expect(() => staffEmailForMobile('12345')).toThrow();
  });

  it('maps a learner code to a family identity on a reserved domain', () => {
    expect(familyEmailForLearnerCode('1234567897')).toBe('f1234567897@family.agla-kadam.invalid');
    expect(() => familyEmailForLearnerCode('1234567890')).toThrow();
  });
});

describe('learner codes', () => {
  it('accepts a code with a valid Luhn check digit', () => {
    expect(isValidLearnerCode('1234567897')).toBe(true);
  });

  it.each(['1234567890', '0234567897', '123456789', '12345678970', '12345678a7'])(
    'rejects %s',
    (code) => {
      expect(isValidLearnerCode(code)).toBe(false);
    },
  );
});

describe('password rules', () => {
  it('accepts a password with letters and digits', () => {
    expect(passwordIssues('kitab2026')).toEqual([]);
    expect(passwordIssues('पुस्तक2026')).toEqual([]);
  });

  it('names every problem', () => {
    expect(passwordIssues('abc')).toEqual(['too_short', 'needs_digit']);
    expect(passwordIssues('12345678')).toEqual(['needs_letter']);
    expect(passwordIssues('a'.repeat(72) + '1')).toEqual(['too_long']);
    expect(passwordIssues('x9876543210', '9876543210')).toEqual(['contains_mobile']);
  });
});

describe('generated credentials', () => {
  it('produces temporary passwords that are readable and satisfy the rules', () => {
    const samples = Array.from({ length: 300 }, () => generateTemporaryPassword());
    for (const password of samples) {
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
      expect(passwordIssues(password)).toEqual([]);
    }
    expect(new Set(samples).size).toBe(samples.length);
  });

  it('produces unusable passwords that the Auth service accepts', () => {
    const password = generateUnusablePassword();
    expect(password).toHaveLength(48);
    expect(passwordIssues(password)).toEqual([]);
  });

  it('produces six-digit PINs that are not trivially guessable', () => {
    for (let index = 0; index < 500; index += 1) {
      const pin = generatePin();
      expect(pin).toMatch(/^[0-9]{6}$/);
      expect(isWeakPin(pin)).toBe(false);
    }
  });

  it.each(['111111', '121212', '123456', '987654', '000001'])('treats %s as weak', (pin) => {
    expect(isWeakPin(pin)).toBe(true);
  });

  it.each(['482915', '730261', '102938'])('treats %s as acceptable', (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });
});

describe('dates in India', () => {
  it('switches to the next day at midnight IST, which is 18:30 UTC', () => {
    expect(todayInIndia(new Date('2026-10-17T18:29:59Z'))).toBe('2026-10-17');
    expect(todayInIndia(new Date('2026-10-17T18:30:00Z'))).toBe('2026-10-18');
  });
});
