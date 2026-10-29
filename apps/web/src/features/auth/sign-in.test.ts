import { describe, expect, it } from 'vitest';
import { staffSignInEmail } from './sign-in';

describe('staffSignInEmail', () => {
  it('maps a mobile number, however it is written, to the staff sign-in identity', () => {
    expect(staffSignInEmail('98765 43210')).toBe('m9876543210@staff.agla-kadam.invalid');
    expect(staffSignInEmail('+91-9876543210')).toBe('m9876543210@staff.agla-kadam.invalid');
  });

  it('accepts the email address of the first super administrator', () => {
    expect(staffSignInEmail(' Admin@Example.org ')).toBe('admin@example.org');
  });

  it('rejects anything else', () => {
    expect(staffSignInEmail('12345')).toBeNull();
    expect(staffSignInEmail('not an email@')).toBeNull();
    expect(staffSignInEmail('')).toBeNull();
  });
});
