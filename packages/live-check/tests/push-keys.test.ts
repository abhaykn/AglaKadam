import { describe, expect, it } from 'vitest';
import { contactOf, newPushKeys } from '../src/push-keys.ts';

describe('push keys', () => {
  it('creates a key pair that signs as the push services expect', async () => {
    const keys = newPushKeys();
    const point = Buffer.from(keys.publicKey, 'base64url');
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(4);
    expect(Buffer.from(keys.privateKey, 'base64url')).toHaveLength(32);

    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    };
    const signing = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, d: keys.privateKey },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const verifying = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode('token');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing, data);
    expect(
      await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifying, signature, data),
    ).toBe(true);
    expect(newPushKeys().publicKey).not.toBe(keys.publicKey);
  });

  it('takes an email address as the contact', () => {
    expect(contactOf(' support@example.org ')).toBe('mailto:support@example.org');
    expect(contactOf('not an address')).toBeNull();
  });
});
