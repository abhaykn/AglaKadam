import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { sessionStore } from '@/features/auth/session';
import { registerChange } from './change-registry';
import { deleteDeviceDatabase, DeviceStore } from './device-store';
import { offlineRuntime } from './offline-runtime';
import { syncStatusStore } from './sync-status';

const send = vi.fn<(payload: { value: number }) => Promise<void>>();
const sessionAvailable = vi.hoisted(() => ({ value: true }));

// The engine checks for a usable session before sending; it follows the session store here.
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => {
        const { sessionStore: store } = await import('@/features/auth/session');
        const state = store.get();
        return {
          data: {
            session:
              sessionAvailable.value && state.status === 'signed-in'
                ? { user: { id: state.userId }, access_token: `token-of-${state.userId}` }
                : null,
          },
        };
      },
    },
  }),
  createClientForToken: (token: () => string) => ({ token }),
}));

registerChange({
  kind: 'test.change',
  schema: z.object({ value: z.number() }),
  send: (payload) => send(payload),
  invalidates: (payload) => [['test-data', payload.value]],
  describe: (payload) => `Test change ${String(payload.value)}`,
});

const received = vi.fn<(text: string) => void>();

// A change that reports the identity it is sent with, after someone else has signed in.
const sentAs = vi.fn<(token: string) => void>();
registerChange({
  kind: 'test.identity',
  schema: z.object({}),
  send: (_payload, context) => {
    signIn('user-b');
    sentAs((context.supabase as unknown as { token: () => string }).token());
    return Promise.resolve();
  },
  invalidates: () => [],
  describe: () => 'Test identity',
});

// A change that carries a recording kept on the device.
registerChange({
  kind: 'test.recording',
  schema: z.object({ fileId: z.string() }),
  send: async (payload, context) => {
    received(await (await context.readFile(payload.fileId)).text());
  },
  files: (payload) => [payload.fileId],
  invalidates: () => [],
  describe: () => 'Test recording',
});

async function storedFileIds(userId: string): Promise<string[]> {
  const store = await DeviceStore.open();
  try {
    return await store.blobIds(userId);
  } finally {
    store.close();
  }
}

function signIn(userId: string): void {
  sessionStore.set({ status: 'signed-in', userId, email: null });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

const describeChange = () => 'change';

let queryClient: QueryClient;

beforeEach(async () => {
  setOnline(true);
  sessionAvailable.value = true;
  send.mockReset();
  send.mockResolvedValue(undefined);
  received.mockReset();
  queryClient = new QueryClient();
  signIn('user-a');
  await offlineRuntime.start('user-a', queryClient);
});

afterEach(async () => {
  offlineRuntime.stop();
  await deleteDeviceDatabase();
  sessionStore.set({ status: 'signed-out' });
  vi.restoreAllMocks();
});

describe('offline runtime', () => {
  it('sends a saved change, removes it and refreshes the affected data', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await offlineRuntime.enqueue('test.change', { value: 7 }, 'key-7');
    await offlineRuntime.flush();

    expect(send).toHaveBeenCalledWith({ value: 7 });
    expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);
    expect(syncStatusStore.get()).toMatchObject({ pending: 0, failed: 0, phase: 'idle' });
    expect(syncStatusStore.get().lastSyncedAt).not.toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['test-data', 7] });
  });

  it('sends a change as the account that made it, even if another signs in meanwhile', async () => {
    await offlineRuntime.enqueue('test.identity', {}, 'identity');
    await offlineRuntime.flush();
    expect(sentAs).toHaveBeenCalledWith('token-of-user-a');
  });

  it('keeps a change that could not be sent for lack of network, to try again later', async () => {
    send.mockRejectedValue({ code: '', message: 'TypeError: Failed to fetch' });
    await offlineRuntime.enqueue('test.change', { value: 1 }, 'key-1');
    await offlineRuntime.flush();

    const [waiting] = await offlineRuntime.waitingChanges(describeChange);
    expect(waiting).toMatchObject({ state: 'pending', attempts: 1, payload: { value: 1 } });
    expect(waiting?.lastError?.code).toBe('network');
    expect(waiting?.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(syncStatusStore.get().pending).toBe(1);
  });

  it('holds a refused change until the person retries or deletes it', async () => {
    send.mockRejectedValueOnce({ code: '42501', message: 'row-level security' });
    await offlineRuntime.enqueue('test.change', { value: 2 }, 'key-2');
    await offlineRuntime.flush();

    let [waiting] = await offlineRuntime.waitingChanges(describeChange);
    expect(waiting).toMatchObject({ state: 'failed', lastError: { code: '42501' } });
    expect(syncStatusStore.get()).toMatchObject({ pending: 0, failed: 1 });

    // Refused changes are not sent again by themselves.
    await offlineRuntime.flush();
    expect(send).toHaveBeenCalledTimes(1);

    await offlineRuntime.retry(waiting?.id ?? '');
    await offlineRuntime.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);

    send.mockRejectedValueOnce({ code: '42501', message: 'row-level security' });
    await offlineRuntime.enqueue('test.change', { value: 3 }, 'key-3');
    await offlineRuntime.flush();
    [waiting] = await offlineRuntime.waitingChanges(describeChange);
    await offlineRuntime.discard(waiting?.id ?? '');
    expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);
    expect(syncStatusStore.get()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('sends only the latest version of a change saved twice', async () => {
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 1 }, 'same-day');
    await offlineRuntime.enqueue('test.change', { value: 2 }, 'same-day');
    setOnline(true);
    await offlineRuntime.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ value: 2 });
  });

  it('waits while offline and sends when the network returns', async () => {
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 5 }, 'key-5');
    await offlineRuntime.flush();
    expect(send).not.toHaveBeenCalled();
    expect(syncStatusStore.get()).toMatchObject({ phase: 'offline', pending: 1 });

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ value: 5 }));
    await offlineRuntime.flush();
    expect(syncStatusStore.get().pending).toBe(0);
  });

  it('keeps each account’s changes apart on a shared device', async () => {
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 9 }, 'key-9');

    signIn('user-b');
    await offlineRuntime.start('user-b', new QueryClient());
    expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);

    signIn('user-a');
    await offlineRuntime.start('user-a', queryClient);
    expect(await offlineRuntime.waitingChanges(describeChange)).toHaveLength(1);
  });

  it('removes everything an account kept when it signs out on purpose', async () => {
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 4 }, 'key-4');
    await offlineRuntime.forgetAccount('user-a');

    const store = await DeviceStore.open();
    expect(await store.outboxEntries('user-a')).toEqual([]);
    store.close();
    expect(offlineRuntime.isAvailable).toBe(false);
  });

  it('opens with the data kept on the device after a restart', async () => {
    await queryClient.query({
      queryKey: ['classes'],
      queryFn: () => Promise.resolve([{ id: 'class-1' }]),
      meta: { persist: true },
    });
    await queryClient.query({
      queryKey: ['not-kept'],
      queryFn: () => Promise.resolve('secret'),
    });
    await offlineRuntime.persistNow();
    offlineRuntime.stop();

    const restarted = new QueryClient();
    await offlineRuntime.start('user-a', restarted);
    expect(restarted.getQueryData(['classes'])).toEqual([{ id: 'class-1' }]);
    expect(restarted.getQueryData(['not-kept'])).toBeUndefined();
  });

  it('sends a change waiting for a retry at once when a person asks', async () => {
    send.mockRejectedValueOnce({ code: '', message: 'TypeError: Failed to fetch' });
    await offlineRuntime.enqueue('test.change', { value: 11 }, 'key-11');
    await offlineRuntime.flush();
    expect(syncStatusStore.get().pending).toBe(1);

    await offlineRuntime.flush({ force: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(syncStatusStore.get().pending).toBe(0);
  });

  it('never brings back an older version saved over while it was failing', async () => {
    const sent: number[] = [];
    send.mockImplementation(async (payload) => {
      sent.push(payload.value);
      if (payload.value === 1) {
        // The teacher saves a newer version while the first one is failing on the network.
        await offlineRuntime.enqueue('test.change', { value: 2 }, 'monday');
        throw Object.assign(new Error('offline'), { code: '' });
      }
    });
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 1 }, 'monday');
    setOnline(true);
    await offlineRuntime.flush({ force: true });
    await offlineRuntime.flush({ force: true });

    expect(sent).toEqual([1, 2]);
    expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);
  });

  it('waits for a session instead of marking changes as refused', async () => {
    sessionAvailable.value = false;
    await offlineRuntime.enqueue('test.change', { value: 6 }, 'key-6');
    await offlineRuntime.flush({ force: true });

    expect(send).not.toHaveBeenCalled();
    const [waiting] = await offlineRuntime.waitingChanges(describeChange);
    expect(waiting).toMatchObject({ state: 'pending', attempts: 0 });

    sessionAvailable.value = true;
    await offlineRuntime.flush({ force: true });
    expect(send).toHaveBeenCalledWith({ value: 6 });
  });

  it('clears the previous account’s data from the cache when another account starts', async () => {
    queryClient.setQueryData(['classes'], [{ id: 'class-of-a' }]);
    signIn('user-b');
    await offlineRuntime.start('user-b', queryClient);
    expect(queryClient.getQueryData(['classes'])).toBeUndefined();
  });

  it('works without the device store when the browser refuses it', async () => {
    offlineRuntime.stop();
    vi.spyOn(DeviceStore, 'open').mockRejectedValueOnce(new Error('blocked'));
    await offlineRuntime.start('user-a', queryClient);
    expect(offlineRuntime.isAvailable).toBe(false);
    expect(syncStatusStore.get().phase).toBe('unavailable');
    await expect(offlineRuntime.enqueue('test.change', { value: 1 }, 'k')).rejects.toThrow();
  });

  it('sends a recording kept on the device and then removes it', async () => {
    setOnline(false);
    const fileId = await offlineRuntime.storeFile(new Blob(['voice'], { type: 'audio/webm' }));
    await offlineRuntime.enqueue('test.recording', { fileId }, `recording-${fileId}`);
    expect(await (await offlineRuntime.readFile(fileId)).text()).toBe('voice');
    expect(await storedFileIds('user-a')).toEqual([fileId]);

    setOnline(true);
    await offlineRuntime.flush({ force: true });
    expect(received).toHaveBeenCalledWith('voice');
    expect(await storedFileIds('user-a')).toEqual([]);
  });

  it('removes the recording of a change that is deleted without sending', async () => {
    setOnline(false);
    const fileId = await offlineRuntime.storeFile(new Blob(['voice'], { type: 'audio/webm' }));
    await offlineRuntime.enqueue('test.recording', { fileId }, `recording-${fileId}`);
    const [waiting] = await offlineRuntime.waitingChanges(describeChange);
    await offlineRuntime.discard(waiting?.id ?? '');
    expect(await storedFileIds('user-a')).toEqual([]);
  });

  it('tidies away old recordings that no waiting change refers to', async () => {
    setOnline(false);
    const kept = await offlineRuntime.storeFile(new Blob(['kept'], { type: 'audio/webm' }));
    await offlineRuntime.enqueue('test.recording', { fileId: kept }, `recording-${kept}`);
    const recent = await offlineRuntime.storeFile(new Blob(['recent'], { type: 'audio/webm' }));
    const abandoned = await offlineRuntime.storeFile(new Blob(['old'], { type: 'audio/webm' }));
    offlineRuntime.stop();

    const store = await DeviceStore.open();
    const blob = await store.blob(abandoned);
    await store.putBlob({ ...blob!, createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 });
    const old = await store.blob(kept);
    await store.putBlob({ ...old!, createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 });
    store.close();

    await offlineRuntime.start('user-a', queryClient);
    await vi.waitFor(async () => {
      expect((await storedFileIds('user-a')).sort()).toEqual([kept, recent].sort());
    });
  });

  it('removes an account’s recordings when it signs out on purpose', async () => {
    setOnline(false);
    await offlineRuntime.storeFile(new Blob(['voice'], { type: 'audio/webm' }));
    await offlineRuntime.forgetAccount('user-a');
    expect(await storedFileIds('user-a')).toEqual([]);
  });

  it('never reads another account’s recording', async () => {
    const fileId = await offlineRuntime.storeFile(new Blob(['voice'], { type: 'audio/webm' }));
    signIn('user-b');
    await offlineRuntime.start('user-b', new QueryClient());
    await expect(offlineRuntime.readFile(fileId)).rejects.toThrow();
  });

  it('never sends a change deleted while earlier ones were being sent', async () => {
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 1 }, 'first');
    await offlineRuntime.enqueue('test.change', { value: 2 }, 'second');
    const changes = await offlineRuntime.waitingChanges(describeChange);
    const second = changes.find((change) => (change.payload as { value: number }).value === 2);
    send.mockImplementation(async (payload) => {
      if (payload.value === 1) {
        await offlineRuntime.discard(second?.id ?? '');
      }
    });
    setOnline(true);
    await offlineRuntime.flush({ force: true });
    expect(send.mock.calls.map(([payload]) => payload.value)).toEqual([1]);
  });

  it('refuses a change whose recording has gone, instead of retrying it for ever', async () => {
    setOnline(false);
    const fileId = await offlineRuntime.storeFile(new Blob(['voice'], { type: 'audio/webm' }));
    await offlineRuntime.enqueue('test.recording', { fileId }, `recording-${fileId}`);
    await offlineRuntime.deleteFiles([fileId]);
    setOnline(true);
    await offlineRuntime.flush({ force: true });
    const [waiting] = await offlineRuntime.waitingChanges(describeChange);
    expect(waiting).toMatchObject({ state: 'failed', lastError: { code: 'file_missing' } });
  });

  it('removes a sent change even when showing the result fails', async () => {
    registerChange({
      kind: 'test.failing-hook',
      schema: z.object({ value: z.number() }),
      send: () => Promise.resolve(),
      onSent: () => {
        throw new Error('The cached data has an unexpected shape.');
      },
      invalidates: () => [],
      describe: () => 'Failing hook',
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await offlineRuntime.enqueue('test.failing-hook', { value: 1 }, 'hook');
    await offlineRuntime.flush({ force: true });
    expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  it('discards a change that may be on its way only once no send is under way', async () => {
    setOnline(false);
    await offlineRuntime.enqueue('test.change', { value: 9 }, 'key-9');
    const [waiting] = await offlineRuntime.waitingChanges(describeChange);
    // A send holds the lock until it ends.
    let endSend: () => void = () => undefined;
    const sendEnded = new Promise<void>((resolve) => {
      endSend = resolve;
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, work: () => Promise<unknown>) => {
          await sendEnded;
          return work();
        },
      },
    });
    try {
      const discarded = offlineRuntime.discard(waiting?.id ?? '');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await offlineRuntime.waitingChanges(describeChange)).toHaveLength(1);
      endSend();
      expect(await discarded).toBe(true);
      expect(await offlineRuntime.waitingChanges(describeChange)).toEqual([]);
      // Discarding again finds nothing left to take back.
      expect(await offlineRuntime.discard(waiting?.id ?? '')).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('says why the device could not keep data, in the browser’s own words', async () => {
    offlineRuntime.stop();
    vi.spyOn(DeviceStore, 'open').mockRejectedValue(
      new DOMException('The user denied permission to access the database.', 'SecurityError'),
    );
    await offlineRuntime.start('user-a', queryClient);
    expect(offlineRuntime.isAvailable).toBe(false);
    expect(syncStatusStore.get()).toMatchObject({
      phase: 'unavailable',
      problem: 'SecurityError: The user denied permission to access the database.',
    });
  });
});
