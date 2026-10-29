import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sealJson } from './cipher';
import { deleteDeviceDatabase, DeviceStore, type OutboxEntry } from './device-store';

let store: DeviceStore;

beforeEach(async () => {
  store = await DeviceStore.open();
});

afterEach(async () => {
  store.close();
  await deleteDeviceDatabase();
});

async function entry(userId: string, overrides: Partial<OutboxEntry> = {}): Promise<OutboxEntry> {
  const key = await store.keyFor(userId);
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    userId,
    kind: 'test.change',
    dedupeKey: 'day-1',
    sealed: await sealJson(key, { value: 1 }, `${userId}|outbox|${id}`),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    state: 'pending',
    lastError: null,
    ...overrides,
  };
}

describe('device store', () => {
  it('keeps one key per account across reopening', async () => {
    const first = await store.keyFor('user-a');
    store.close();
    store = await DeviceStore.open();
    expect(await store.keyFor('user-a')).toEqual(first);
    expect(await store.keyFor('user-b')).not.toBe(first);
  });

  it('keeps only the latest waiting change for the same dedupe key', async () => {
    await store.replaceOutboxEntry(await entry('user-a', { id: 'first' }));
    await store.replaceOutboxEntry(await entry('user-a', { id: 'second' }));
    await store.replaceOutboxEntry(await entry('user-a', { id: 'other', dedupeKey: 'day-2' }));
    const ids = (await store.outboxEntries('user-a')).map((item) => item.id);
    expect(ids.sort()).toEqual(['other', 'second']);
  });

  it('does not remove a change that was saved again while it was being sent', async () => {
    const sent = await entry('user-a', { id: 'x', updatedAt: 1 });
    await store.putOutboxEntry(sent);
    await store.putOutboxEntry({ ...sent, updatedAt: 2 });
    expect(await store.deleteSentOutboxEntry('x', 1)).toBe(false);
    expect(await store.outboxEntry('x')).toBeDefined();
    expect(await store.deleteSentOutboxEntry('x', 2)).toBe(true);
    expect(await store.outboxEntry('x')).toBeUndefined();
  });

  it('forgets one account completely and leaves the others', async () => {
    await store.putOutboxEntry(await entry('user-a'));
    await store.putOutboxEntry(await entry('user-b'));
    const keyB = await store.keyFor('user-b');
    await store.putSnapshot({
      userId: 'user-a',
      name: 'queries',
      sealed: await sealJson(await store.keyFor('user-a'), [], 'x'),
      savedAt: 1,
    });

    await store.forgetAccount('user-a');

    expect(await store.outboxEntries('user-a')).toEqual([]);
    expect(await store.snapshot('user-a', 'queries')).toBeUndefined();
    expect(await store.outboxEntries('user-b')).toHaveLength(1);
    expect(await store.keyFor('user-b')).toEqual(keyB);
  });

  it('tidies up after long-unused accounts but never deletes changes they have not sent', async () => {
    const day = 24 * 60 * 60 * 1000;
    const later = Date.now() + 50 * day;
    await store.keyFor('idle-with-changes');
    await store.putOutboxEntry(await entry('idle-with-changes'));
    await store.putSnapshot({
      userId: 'idle-with-changes',
      name: 'queries',
      sealed: await sealJson(await store.keyFor('idle-with-changes'), [], 'x'),
      savedAt: 1,
    });
    await store.keyFor('idle-without-changes');
    await store.keyFor('starting-now');

    const forgotten = await store.forgetInactiveAccounts(45 * day, {
      except: 'starting-now',
      now: later,
    });

    expect(forgotten).toEqual(['idle-without-changes']);
    expect(await store.outboxEntries('idle-with-changes')).toHaveLength(1);
    expect(await store.snapshot('idle-with-changes', 'queries')).toBeUndefined();
  });

  it('does not trust a clock that has gone backwards', async () => {
    await store.keyFor('user-a');
    const earlier = Date.now() - 100 * 24 * 60 * 60 * 1000;
    expect(await store.forgetInactiveAccounts(1, { now: earlier })).toEqual([]);
  });

  it('changes a waiting entry only if it still exists and was not saved again', async () => {
    const waiting = await entry('user-a', { id: 'w', updatedAt: 5 });
    await store.putOutboxEntry(waiting);
    expect(await store.updateOutboxEntry('w', 4, { attempts: 9 })).toBe(false);
    expect(await store.updateOutboxEntry('w', 5, { attempts: 1 })).toBe(true);
    expect((await store.outboxEntry('w'))?.attempts).toBe(1);
    await store.deleteOutboxEntry('w');
    // A change that was sent meanwhile is not brought back.
    expect(await store.updateOutboxEntry('w', null, { state: 'pending' })).toBe(false);
    expect(await store.outboxEntry('w')).toBeUndefined();
  });
});
