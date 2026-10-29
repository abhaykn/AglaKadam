import { describe, expect, it, vi } from 'vitest';
import {
  encryptMessage,
  fromBase64Url,
  isPushService,
  sendPush,
  toBase64Url,
  vapidAuthorization,
  vapidSigner,
} from '../../../supabase/functions/_shared/web-push.ts';

/** The worked example of RFC 8291, Appendix A. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  serverPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  userAgentPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  userAgentPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const encoder = new TextEncoder();

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

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(new ArrayBuffer(parts.reduce((sum, part) => sum + part.length, 0)));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** What a browser does with a received message: an independent decryption to check against. */
async function decryptAsBrowser(
  body: Uint8Array,
  userAgentPublic: Uint8Array,
  userAgentPrivate: Uint8Array,
  authSecret: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const keyLength = body[20] ?? 0;
  const serverPublic = body.slice(21, 21 + keyLength);
  const ciphertext = body.slice(21 + keyLength);
  const jwk = (publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey => ({
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33, 65)),
    ...(privateKey ? { d: toBase64Url(privateKey) } : {}),
  });
  const own = await crypto.subtle.importKey(
    'jwk',
    jwk(userAgentPublic, userAgentPrivate),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const theirs = await crypto.subtle.importKey(
    'jwk',
    jwk(serverPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, own, 256),
  );
  const info = concat(encoder.encode('WebPush: info\0'), userAgentPublic, serverPublic);
  const keyMaterial = await hmac(await hmac(authSecret, shared), concat(info, new Uint8Array([1])));
  const pseudoRandom = await hmac(salt, keyMaterial);
  const contentKey = (
    await hmac(pseudoRandom, concat(encoder.encode('Content-Encoding: aes128gcm\0\x01')))
  ).slice(0, 16);
  const nonce = (
    await hmac(pseudoRandom, concat(encoder.encode('Content-Encoding: nonce\0\x01')))
  ).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  );
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('message encryption (RFC 8291)', () => {
  it('produces the worked example of the RFC exactly', async () => {
    const body = await encryptMessage(
      { p256dh: RFC.userAgentPublic, auth: RFC.authSecret },
      encoder.encode(RFC.plaintext),
      {
        salt: fromBase64Url(RFC.salt),
        publicKey: fromBase64Url(RFC.serverPublic),
        privateKey: fromBase64Url(RFC.serverPrivate),
      },
    );
    expect(toBase64Url(body)).toBe(RFC.body);
  });

  it('can be decrypted by the browser, with a fresh key and salt every time', async () => {
    const message = JSON.stringify({
      title: 'अगले सप्ताह की योजना तैयार है',
      url: '/app/crp/plan',
    });
    const keys = { p256dh: RFC.userAgentPublic, auth: RFC.authSecret };
    const first = await encryptMessage(keys, encoder.encode(message));
    const second = await encryptMessage(keys, encoder.encode(message));
    expect(toBase64Url(first)).not.toBe(toBase64Url(second));
    for (const body of [first, second]) {
      expect(
        await decryptAsBrowser(
          body,
          fromBase64Url(RFC.userAgentPublic),
          fromBase64Url(RFC.userAgentPrivate),
          fromBase64Url(RFC.authSecret),
        ),
      ).toBe(message);
    }
  });

  it('refuses a message too long for one record', async () => {
    await expect(
      encryptMessage(
        { p256dh: RFC.userAgentPublic, auth: RFC.authSecret },
        new Uint8Array(new ArrayBuffer(4000)),
      ),
    ).rejects.toThrow('too long');
  });
});

describe('application identity (RFC 8292)', () => {
  it('signs a token for the push service with the application key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const publicKey = toBase64Url(
      new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    );
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const now = Date.UTC(2026, 9, 25, 13, 30);
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc123',
      { publicKey, privateKey: privateJwk.d ?? '', subject: 'mailto:support@example.org' },
      now,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head = '', claims = '', signature = '', key = ''] = match ?? [];
    expect(key).toBe(publicKey);
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 60 * 60,
      sub: 'mailto:support@example.org',
    });
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.publicKey,
        fromBase64Url(signature),
        encoder.encode(`${head}.${claims}`),
      ),
    ).toBe(true);
  });
});

async function newKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  return {
    publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d ?? '',
    subject: 'mailto:support@example.org',
  };
}

describe('the application keys', () => {
  it('are checked once: a key of another pair or a wrong contact is refused', async () => {
    const keys = await newKeys();
    const other = await newKeys();
    await expect(vapidSigner({ ...keys, privateKey: other.privateKey })).rejects.toThrow(
      'matching P-256 pair',
    );
    await expect(vapidSigner({ ...keys, subject: 'support@example.org' })).rejects.toThrow(
      'mailto',
    );
    await expect(vapidSigner({ ...keys, privateKey: 'c2hvcnQ' })).rejects.toThrow('32 bytes');
    await expect(vapidSigner({ ...keys, publicKey: 'BPublicKey' })).rejects.toThrow();
  });

  it('reuse a token for each push service until it is close to expiring', async () => {
    const signer = await vapidSigner(await newKeys());
    const now = Date.UTC(2026, 9, 25, 1, 30);
    const first = await signer.authorization('https://fcm.googleapis.com/fcm/send/a', now);
    expect(await signer.authorization('https://fcm.googleapis.com/fcm/send/b', now + 60_000)).toBe(
      first,
    );
    expect(
      await signer.authorization('https://updates.push.services.mozilla.com/wpush/v2/c', now),
    ).not.toBe(first);
    expect(
      await signer.authorization('https://fcm.googleapis.com/fcm/send/a', now + 11.5 * 3_600_000),
    ).not.toBe(first);
  });
});

describe('sending', () => {
  const target = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/1',
    keys: { p256dh: RFC.userAgentPublic, auth: RFC.authSecret },
  };

  it('posts the encrypted message and reads the answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const signer = await vapidSigner(await newKeys());
    expect(await sendPush(target, { title: 'Hello' }, signer, { ttlSeconds: 60 }, fetcher)).toBe(
      'sent',
    );
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(target.endpoint);
    expect(init.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      TTL: '60',
      Urgency: 'normal',
    });
    expect(String((init.headers as Record<string, string>).Authorization)).toMatch(/^vapid t=/);
    // A redirect is not followed, and a push service that does not answer is given up on.
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('tells a subscription that is gone from a passing failure', async () => {
    const signer = await vapidSigner(await newKeys());
    const answer = (status: number) => vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(await sendPush(target, {}, signer, {}, answer(410))).toBe('gone');
    expect(await sendPush(target, {}, signer, {}, answer(404))).toBe('gone');
    expect(await sendPush(target, {}, signer, {}, answer(429))).toBe('failed');
    expect(await sendPush(target, {}, signer, {}, answer(301))).toBe('failed');
  });

  it('calls only the push services of the browsers', async () => {
    const signer = await vapidSigner(await newKeys());
    const fetcher = vi.fn();
    for (const endpoint of [
      'https://push.example.org/send/1',
      'http://fcm.googleapis.com/fcm/send/1',
      'https://fcm.googleapis.com:8443/fcm/send/1',
      'https://fcm.googleapis.com.example.org/x',
      'not a url',
    ]) {
      expect(isPushService(endpoint)).toBe(false);
      expect(await sendPush({ ...target, endpoint }, {}, signer, {}, fetcher)).toBe('failed');
    }
    expect(fetcher).not.toHaveBeenCalled();
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/1',
      'https://updates.push.services.mozilla.com/wpush/v2/1',
      'https://web.push.apple.com/1',
      'https://wns2-pn1p.notify.windows.com/w/?token=1',
    ]) {
      expect(isPushService(endpoint)).toBe(true);
    }
  });
});
