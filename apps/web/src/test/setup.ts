import '@testing-library/jest-dom/vitest';
// IndexedDB for the offline store; jsdom has none.
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { initialisePreferences, setLanguage } from '@/features/preferences/preferences';
import { initialiseI18n } from '@/i18n';

// jsdom does not implement matchMedia; components only need a stable "no match" answer.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom does not implement scrolling; the router calls it on every navigation.
window.scrollTo = () => undefined;

// Screens that wait for the device store render later when the machine is busy (for example
// while every test file runs in parallel); waiting a little longer keeps the result the same.
configure({ asyncUtilTimeout: 5_000 });

setLanguage('en');
initialisePreferences();
initialiseI18n();

afterEach(() => {
  cleanup();
  setLanguage('en');
  window.localStorage.clear();
});
