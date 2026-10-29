import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const deleted = vi.hoisted(() => vi.fn());
const callFunction = vi.hoisted(() => vi.fn());
const signals = vi.hoisted(() => [] as AbortSignal[]);

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc,
    from: () => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          const result = deleted(column, value) as Promise<unknown>;
          return Object.assign(result, {
            abortSignal: (signal: AbortSignal) => {
              signals.push(signal);
              return result;
            },
          });
        },
      }),
    }),
  }),
}));
vi.mock('@/lib/functions', () => ({ callFunction }));

import {
  disablePush,
  enablePush,
  forgetPushOnSignOut,
  NotificationsRefusedError,
  NotificationsUnavailableError,
  pushState,
} from './push';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer | null },
  toJSON: () => ({ keys: { p256dh: 'BKey', auth: 'secret' } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

function installBrowser(permission: NotificationPermission, subscribed: boolean) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscribed ? subscription : null),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
  // Only their presence matters to the code under test.
  vi.stubGlobal('PushManager', function PushManager() {
    return undefined;
  });
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn().mockResolvedValue(permission === 'default' ? 'granted' : permission),
  });
  return pushManager;
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  deleted.mockReset().mockResolvedValue({ error: null });
  callFunction.mockReset().mockResolvedValue({ publicKey: 'AQID' });
  subscription.unsubscribe.mockClear();
  subscription.options.applicationServerKey = new Uint8Array([1, 2, 3]).buffer;
  signals.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('notifications on this phone', () => {
  it('reports a browser that cannot receive them', async () => {
    expect(await pushState()).toBe('unsupported');
    await expect(enablePush()).rejects.toBeInstanceOf(NotificationsRefusedError);
  });

  it('subscribes with the application key and keeps the subscription for the account', async () => {
    const pushManager = installBrowser('default', false);
    await enablePush();
    expect(callFunction).toHaveBeenCalledWith('notify', { action: 'public_key' });
    const options = pushManager.subscribe.mock.calls[0]?.[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect([...options.applicationServerKey]).toEqual([1, 2, 3]);
    expect(rpc).toHaveBeenCalledWith('keep_push_subscription', {
      endpoint: subscription.endpoint,
      p256dh: 'BKey',
      auth_secret: 'secret',
    });
  });

  it('does not wait for offline support the browser never installed', async () => {
    installBrowser('default', false);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: new Promise(() => undefined),
        getRegistration: vi.fn().mockResolvedValue(undefined),
      },
    });
    const ask = vi.fn();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: ask });
    await expect(enablePush()).rejects.toBeInstanceOf(NotificationsUnavailableError);
    expect(ask).not.toHaveBeenCalled();
  });

  it('keeps a subscription made with the current key', async () => {
    const pushManager = installBrowser('granted', true);
    await enablePush();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('subscribes again when the application keys were replaced', async () => {
    const pushManager = installBrowser('granted', true);
    subscription.options.applicationServerKey = new Uint8Array([9, 9, 9]).buffer;
    await enablePush();
    expect(deleted).toHaveBeenCalledWith('endpoint', subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  it('stops notifications at once on sign-out and does not wait long for the server', async () => {
    installBrowser('granted', true);
    const order: string[] = [];
    subscription.unsubscribe.mockImplementationOnce(() => {
      order.push('browser');
      return Promise.resolve(true);
    });
    deleted.mockImplementationOnce(() => {
      order.push('server');
      return Promise.reject(new Error('The network is down.'));
    });
    await forgetPushOnSignOut();
    expect(order).toEqual(['browser', 'server']);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('signs out even when the browser push service never answers', async () => {
    installBrowser('granted', true);
    subscription.unsubscribe.mockImplementationOnce(() => new Promise<boolean>(() => undefined));
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      void forgetPushOnSignOut().then(done);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing more when the person refuses', async () => {
    installBrowser('denied', false);
    expect(await pushState()).toBe('denied');
    await expect(enablePush()).rejects.toBeInstanceOf(NotificationsRefusedError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('forgets the subscription on the server and in the browser when turned off', async () => {
    installBrowser('granted', true);
    expect(await pushState()).toBe('on');
    await disablePush();
    expect(deleted).toHaveBeenCalledWith('endpoint', subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('keeps notifications on when the server could not forget the phone', async () => {
    installBrowser('granted', true);
    deleted.mockResolvedValueOnce({ error: { code: 'PGRST301', message: 'Offline.' } });
    await expect(disablePush()).rejects.toMatchObject({ code: 'PGRST301' });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});
