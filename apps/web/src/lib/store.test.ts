import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('notifies subscribers only when the value changes', () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(1);
    expect(listener).not.toHaveBeenCalled();

    store.set((previous) => previous + 1);
    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore('a');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set('b');
    expect(listener).not.toHaveBeenCalled();
  });
});
