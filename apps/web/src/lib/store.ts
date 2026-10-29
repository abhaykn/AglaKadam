import { useSyncExternalStore } from 'react';

type Listener = () => void;
type Updater<T> = T | ((previous: T) => T);

export interface Store<T> {
  get: () => T;
  set: (next: Updater<T>) => void;
  subscribe: (listener: Listener) => () => void;
}

/**
 * Minimal observable store for small pieces of client state that must be readable outside
 * React (service worker events, browser listeners) as well as inside components.
 */
export function createStore<T>(initialValue: T): Store<T> {
  let value = initialValue;
  const listeners = new Set<Listener>();

  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) {
        return;
      }
      value = resolved;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Subscribes a component to a store. Selectors must return primitives or stable references,
 * otherwise React will re-render on every store change.
 */
export function useStore<T, Selected = T>(
  store: Store<T>,
  selector: (state: T) => Selected = (state) => state as unknown as Selected,
): Selected {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
