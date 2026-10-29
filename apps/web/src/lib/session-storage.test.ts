import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'ak.session';
const SESSION = JSON.stringify({ user: { id: 'user-1' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('session storage', () => {
  it('moves a session kept by an earlier version out of localStorage, once', async () => {
    localStorage.setItem(KEY, SESSION);
    localStorage.setItem(`${KEY}-code-verifier`, 'verifier');
    localStorage.setItem('ak.language', 'hi');
    const { authStorage } = await import('./session-storage');

    expect(await authStorage.getItem(KEY)).toBe(SESSION);
    expect(await authStorage.getItem(`${KEY}-code-verifier`)).toBe('verifier');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(`${KEY}-code-verifier`)).toBeNull();
    // Other settings stay where they are.
    expect(localStorage.getItem('ak.language')).toBe('hi');

    await authStorage.removeItem(KEY);
    await authStorage.removeItem(`${KEY}-code-verifier`);
  });

  it('keeps, replaces and removes the session in the device database', async () => {
    const { authStorage } = await import('./session-storage');
    await authStorage.setItem(KEY, SESSION);
    expect(await authStorage.getItem(KEY)).toBe(SESSION);
    expect(localStorage.getItem(KEY)).toBeNull();

    await authStorage.setItem(KEY, '{"user":{"id":"user-2"}}');
    expect(await authStorage.getItem(KEY)).toBe('{"user":{"id":"user-2"}}');

    // A copy an earlier version left behind is removed too, so a removed session never returns.
    localStorage.setItem(KEY, SESSION);
    await authStorage.removeItem(KEY);
    expect(await authStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('uses localStorage where the browser has no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { authStorage } = await import('./session-storage');
    await authStorage.setItem(KEY, SESSION);
    expect(localStorage.getItem(KEY)).toBe(SESSION);
    expect(await authStorage.getItem(KEY)).toBe(SESSION);
    await authStorage.removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
