import { describe, expect, it } from 'vitest';
import { createDeviceKey, openJson, sealJson } from './cipher';

describe('device encryption', () => {
  it('reads back what was written', async () => {
    const key = await createDeviceKey();
    const value = { classSectionId: 'c1', absent: ['s1', 's2'], note: 'हिंदी में भी' };
    const sealed = await sealJson(key, value, 'user|outbox|1');
    expect(await openJson(key, sealed, 'user|outbox|1')).toEqual(value);
  });

  it('keeps no readable text in what is stored', async () => {
    const key = await createDeviceKey();
    const sealed = await sealJson(key, { name: 'Asha Kumari' }, 'context');
    const stored = new TextDecoder().decode(sealed.data);
    expect(stored).not.toContain('Asha');
  });

  it('uses a fresh IV every time', async () => {
    const key = await createDeviceKey();
    const first = await sealJson(key, 'same', 'context');
    const second = await sealJson(key, 'same', 'context');
    expect(first.iv).not.toEqual(second.iv);
  });

  it('cannot be read with another key', async () => {
    const sealed = await sealJson(await createDeviceKey(), 'secret', 'context');
    await expect(openJson(await createDeviceKey(), sealed, 'context')).rejects.toThrow();
  });

  it('cannot be moved to another record or account', async () => {
    const key = await createDeviceKey();
    const sealed = await sealJson(key, 'secret', 'user-a|outbox|1');
    await expect(openJson(key, sealed, 'user-b|outbox|1')).rejects.toThrow();
    await expect(openJson(key, sealed, 'user-a|outbox|2')).rejects.toThrow();
  });

  it('makes a key whose value can never be read', async () => {
    const key = await createDeviceKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});
