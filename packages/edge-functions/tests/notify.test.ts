import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  handleNotify,
  PARALLEL_SENDS,
  type Sender,
} from '../../../supabase/functions/notify/handler.ts';
import { messageFor } from '../../../supabase/functions/notify/messages.ts';
import type {
  NotifyKind,
  NotifyRecipient,
  NotifyServices,
} from '../../../supabase/functions/_shared/services.ts';
import {
  toBase64Url,
  type VapidSigner,
  vapidSigner,
} from '../../../supabase/functions/_shared/web-push.ts';

const TOKEN = 'b'.repeat(64);
const TODAY = '2026-10-25';
let KEYS: Promise<VapidSigner>;
let PUBLIC_KEY = '';

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  PUBLIC_KEY = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  KEYS = vapidSigner({
    publicKey: PUBLIC_KEY,
    privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d ?? '',
    subject: 'mailto:support@example.org',
  });
  await KEYS;
});

function recipient(endpoint: string, overrides: Partial<NotifyRecipient> = {}): NotifyRecipient {
  return {
    endpoint,
    keys: { p256dh: 'p256dh', auth: 'auth' },
    language: 'en',
    message: 'plan_ready',
    firstCount: 2,
    secondCount: 1,
    ...overrides,
  };
}

class FakeNotify implements NotifyServices {
  asked: { kind: NotifyKind; onDate: string }[] = [];
  sent: string[] = [];
  gone: string[] = [];
  outcomes = 0;

  constructor(private readonly due: NotifyRecipient[]) {}

  jobTokenIsValid(token: string) {
    return Promise.resolve(token === TOKEN);
  }

  recipients(kind: NotifyKind, onDate: string) {
    this.asked.push({ kind, onDate });
    return Promise.resolve(this.due);
  }

  outcome(sent: string[], gone: string[]) {
    this.outcomes += 1;
    this.sent.push(...sent);
    this.gone.push(...gone);
    return Promise.resolve();
  }
}

describe('the notify function', () => {
  it('tells anyone the public key to subscribe with, and nothing else without the token', async () => {
    const services = new FakeNotify([recipient('https://push.example.org/1')]);
    const send = vi.fn<Sender>();
    expect(await handleNotify(null, { action: 'public_key' }, services, KEYS, send, TODAY)).toEqual(
      { status: 200, body: { publicKey: PUBLIC_KEY } },
    );
    expect(
      await handleNotify(null, { action: 'public_key' }, services, null, send, TODAY),
    ).toMatchObject({ status: 503 });
    expect(await handleNotify(null, { kind: 'daily' }, services, KEYS, send, TODAY)).toMatchObject({
      status: 403,
    });
    expect(
      await handleNotify(TOKEN, { kind: 'everything' }, services, KEYS, send, TODAY),
    ).toMatchObject({ status: 400 });
    expect(await handleNotify(TOKEN, { kind: 'daily' }, services, null, send, TODAY)).toMatchObject(
      {
        status: 503,
      },
    );
    expect(send).not.toHaveBeenCalled();
    expect(services.asked).toEqual([]);
  });

  it('reports keys that are set but not valid, and sends nothing', async () => {
    const services = new FakeNotify([recipient('https://fcm.googleapis.com/fcm/send/1')]);
    const send = vi.fn<Sender>();
    const log = vi.fn();
    const broken = vapidSigner({
      publicKey: 'BPublicKey',
      privateKey: 'private',
      subject: 'mailto:support@example.org',
    });
    expect(
      await handleNotify(TOKEN, { kind: 'daily' }, services, broken, send, TODAY, log),
    ).toMatchObject({ status: 503 });
    expect(
      await handleNotify(null, { action: 'public_key' }, services, broken, send, TODAY, log),
    ).toMatchObject({ status: 503 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('The push keys are not valid'));
    expect(send).not.toHaveBeenCalled();
  });

  it('sends each message, forgets the subscriptions that are gone and counts the rest', async () => {
    const due = Array.from({ length: PARALLEL_SENDS + 3 }, (_, index) =>
      recipient(`https://push.example.org/${String(index)}`),
    );
    const services = new FakeNotify(due);
    const send = vi.fn<Sender>((target) =>
      Promise.resolve(
        target.endpoint.endsWith('/1')
          ? 'gone'
          : target.endpoint.endsWith('/2')
            ? 'failed'
            : 'sent',
      ),
    );
    const result = await handleNotify(TOKEN, { kind: 'plan_ready' }, services, KEYS, send, TODAY);
    expect(result).toEqual({ status: 200, body: { sent: due.length - 2, gone: 1, failed: 1 } });
    expect(services.asked).toEqual([{ kind: 'plan_ready', onDate: TODAY }]);
    expect(services.gone).toEqual(['https://push.example.org/1']);
    expect(services.sent).toHaveLength(due.length - 2);
    // What each group of messages learnt is kept at once.
    expect(services.outcomes).toBe(2);
    const [, message, keys, options] = send.mock.calls[0] ?? [];
    expect(message).toEqual({
      title: 'Plan the coming week',
      body: '2 check-backs due and 1 visit request waiting.',
      url: '/app/crp/plan',
      tag: 'plan-ready',
    });
    expect(keys).toBe(await KEYS);
    expect(options).toEqual({ ttlSeconds: 14 * 60 * 60, topic: 'plan-ready' });
  });

  it('counts a send that threw as failed and carries on', async () => {
    const services = new FakeNotify([
      recipient('https://push.example.org/a'),
      recipient('https://push.example.org/b'),
    ]);
    const send = vi.fn<Sender>((target) =>
      target.endpoint.endsWith('/a')
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve('sent'),
    );
    expect(await handleNotify(TOKEN, { kind: 'daily' }, services, KEYS, send, TODAY)).toMatchObject(
      { body: { sent: 1, gone: 0, failed: 1 } },
    );
  });
});

describe('the messages', () => {
  it("says what is due in the person's language, without naming any child", () => {
    const cases: NotifyRecipient[] = [
      recipient('x', { message: 'plan_ready', firstCount: 0, secondCount: 0 }),
      recipient('x', { message: 'check_back_crp', firstCount: 1 }),
      recipient('x', { message: 'check_back_teacher' }),
      recipient('x', { message: 'pulse_week', firstCount: 5 }),
    ];
    expect(cases.map((entry) => messageFor(entry))).toEqual([
      {
        title: 'Plan the coming week',
        body: "Open the week's plan to choose the classes to visit.",
        url: '/app/crp/plan',
        tag: 'plan-ready',
      },
      {
        title: 'A check-back is due today',
        body: '1 agreed step in your cluster is due for a check-back today.',
        url: '/app/crp',
        tag: 'check-back',
      },
      expect.objectContaining({ url: '/app/teacher', tag: 'check-back' }),
      {
        title: "This week's Pulse is open",
        body: '5 children in your classes are due for a Pulse check this week.',
        url: '/app/teacher',
        tag: 'pulse-week',
      },
    ]);
    const hindi = messageFor(
      recipient('x', { language: 'hi', message: 'pulse_week', firstCount: 5 }),
    );
    expect(hindi.title).toBe('इस सप्ताह की पल्स खुल गई');
    expect(hindi.body).toBe('आपकी कक्षाओं के 5 बच्चों की पल्स जाँच इस सप्ताह होनी है।');
    expect(
      messageFor(
        recipient('x', { language: 'hi', message: 'plan_ready', firstCount: 1, secondCount: 2 }),
      ).body,
    ).toBe('इस सप्ताह 1 तय कदम की जाँच और 2 मुलाक़ात के अनुरोध बाकी।');
  });
});
