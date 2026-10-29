import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { authStorage, SESSION_STORAGE_KEY } from '@/lib/session-storage';
import { registerChange } from './change-registry';
import { sealJson } from './cipher';
import { deleteDeviceDatabase, DeviceStore } from './device-store';
import { outboxContext } from './outbox-sync';
import { SendInterruptedError, sendFromWorker } from './worker-sync';

const send = vi.fn<(payload: { value: number }) => Promise<void>>();

const tokens = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/supabase', () => ({
  createWorkerSupabase: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: 'user-a' }, access_token: 'token-of-user-a' } },
        }),
    },
  }),
  createClientForToken: (token: string) => {
    tokens.push(token);
    return {};
  },
}));

registerChange({
  kind: 'worker-test.change',
  schema: z.object({ value: z.number() }),
  send: (payload) => send(payload),
  invalidates: () => [],
  describe: () => 'Worker test change',
});

async function saveChange(userId: string, value: number, createKey = true): Promise<void> {
  const store = await DeviceStore.open();
  try {
    if (!createKey) {
      return;
    }
    const key = await store.keyFor(userId);
    const id = crypto.randomUUID();
    const now = Date.now();
    await store.replaceOutboxEntry({
      id,
      userId,
      kind: 'worker-test.change',
      dedupeKey: `worker-test:${String(value)}`,
      sealed: await sealJson(key, { value }, outboxContext(userId, id)),
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      // Waiting for a retry: the worker sends anyway, since a network has just returned.
      nextAttemptAt: now + 60_000,
      state: 'pending',
      lastError: null,
    });
  } finally {
    store.close();
  }
}

async function waiting(userId: string): Promise<number> {
  const store = await DeviceStore.open();
  try {
    return (await store.outboxEntries(userId)).length;
  } finally {
    store.close();
  }
}

beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue(undefined);
  tokens.length = 0;
  await authStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user: { id: 'user-a' } }));
});

afterEach(async () => {
  await authStorage.removeItem(SESSION_STORAGE_KEY);
  await deleteDeviceDatabase();
});

describe('sending from the service worker', () => {
  it('sends the signed-in account’s waiting changes after the app was closed', async () => {
    await saveChange('user-a', 1);
    await saveChange('user-a', 2);
    await sendFromWorker();
    expect(send.mock.calls.map(([payload]) => payload.value)).toEqual([1, 2]);
    expect(await waiting('user-a')).toBe(0);
    // Every request is made with the account's own token.
    expect(tokens).toEqual(['token-of-user-a']);
  });

  it('stops as soon as the account signs out during a run', async () => {
    send.mockImplementation(async () => {
      await authStorage.removeItem(SESSION_STORAGE_KEY);
    });
    await saveChange('user-a', 1);
    await saveChange('user-a', 2);
    await sendFromWorker();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await waiting('user-a')).toBe(1);
  });

  it('leaves other accounts on a shared device alone', async () => {
    await saveChange('user-b', 7);
    await sendFromWorker();
    expect(send).not.toHaveBeenCalled();
    expect(await waiting('user-b')).toBe(1);
  });

  it('does nothing without a signed-in person or a key on this device', async () => {
    await authStorage.removeItem(SESSION_STORAGE_KEY);
    await saveChange('user-a', 3);
    await sendFromWorker();
    expect(send).not.toHaveBeenCalled();

    await deleteDeviceDatabase();
    await authStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user: { id: 'user-a' } }));
    await saveChange('user-a', 4, false);
    await sendFromWorker();
    expect(send).not.toHaveBeenCalled();
    // The worker never creates a key of its own.
    const store = await DeviceStore.open();
    expect(await store.existingKeyFor('user-a')).toBeUndefined();
    store.close();
  });

  it('asks the browser to try again when the connection drops', async () => {
    send.mockRejectedValue({ code: '', message: 'TypeError: Failed to fetch' });
    await saveChange('user-a', 5);
    await expect(sendFromWorker()).rejects.toBeInstanceOf(SendInterruptedError);
    expect(await waiting('user-a')).toBe(1);
  });
});
