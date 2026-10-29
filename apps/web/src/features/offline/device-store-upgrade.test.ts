import { afterEach, describe, expect, it } from 'vitest';
import { inTransaction, openDatabase, requestResult } from '@/lib/idb';
import { sealBytes } from './cipher';
import { deleteDeviceDatabase, DeviceStore } from './device-store';

afterEach(async () => {
  await deleteDeviceDatabase();
});

/** The device database as the first version of the application created it. */
async function createFirstVersion(): Promise<void> {
  const database = await openDatabase('agla-kadam', 1, (created) => {
    created.createObjectStore('keys', { keyPath: 'userId' });
    const outbox = created.createObjectStore('outbox', { keyPath: 'id' });
    outbox.createIndex('byUser', 'userId');
    outbox.createIndex('byUserAndDedupeKey', ['userId', 'dedupeKey']);
    created.createObjectStore('snapshots', { keyPath: ['userId', 'name'] });
  });
  await inTransaction(database, 'outbox', 'readwrite', async (transaction) => {
    await requestResult(
      transaction.objectStore('outbox').put({
        id: 'waiting-1',
        userId: 'user-a',
        kind: 'attendance.save',
        dedupeKey: 'attendance:class:2026-10-18',
        sealed: { v: 1, iv: new Uint8Array(12), data: new ArrayBuffer(8) },
        createdAt: 1,
        updatedAt: 1,
        attempts: 0,
        nextAttemptAt: 1,
        state: 'pending',
        lastError: null,
      }),
    );
  });
  database.close();
}

describe('upgrading the device database', () => {
  it('adds the store for recordings and keeps the changes that were waiting', async () => {
    await createFirstVersion();
    const store = await DeviceStore.open();
    try {
      expect((await store.outboxEntries('user-a')).map((entry) => entry.id)).toEqual(['waiting-1']);

      const key = await store.keyFor('user-a');
      const sealed = await sealBytes(key, new Uint8Array([1, 2, 3]), 'user-a|blobs|file-1');
      await store.putBlob({
        id: 'file-1',
        userId: 'user-a',
        sealed,
        mimeType: 'audio/webm',
        size: 3,
        createdAt: Date.now(),
      });
      expect(await store.blobIds('user-a')).toEqual(['file-1']);

      await store.forgetAccount('user-a');
      expect(await store.blobIds('user-a')).toEqual([]);
      expect(await store.outboxEntries('user-a')).toEqual([]);
    } finally {
      store.close();
    }
  });
});
