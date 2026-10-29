import { readLocal, writeLocal } from '@/lib/local-storage';
import { createStore } from '@/lib/store';

export const supportedLanguages = ['en', 'hi'] as const;
export type Language = (typeof supportedLanguages)[number];

export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

const LANGUAGE_KEY = 'ak.language';
const THEME_KEY = 'ak.theme';

function isLanguage(value: string | null): value is Language {
  return value !== null && (supportedLanguages as readonly string[]).includes(value);
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && (themePreferences as readonly string[]).includes(value);
}

function detectInitialLanguage(): Language {
  const stored = readLocal(LANGUAGE_KEY);
  if (isLanguage(stored)) {
    return stored;
  }
  const browserLanguages = typeof navigator === 'undefined' ? [] : navigator.languages;
  return browserLanguages.some((tag) => tag.toLowerCase().startsWith('hi')) ? 'hi' : 'en';
}

function detectInitialTheme(): ThemePreference {
  const stored = readLocal(THEME_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

export const languageStore = createStore<Language>(detectInitialLanguage());
export const themeStore = createStore<ThemePreference>(detectInitialTheme());

const darkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return darkQuery?.matches ? 'dark' : 'light';
  }
  return preference;
}

function applyTheme(): void {
  // The product has one look, the night theme, on every screen and in every overlay.
  const root = document.documentElement;
  root.dataset.theme = 'dark';
  root.classList.add('theme-night');
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = '#012B42';
  }
}

function applyLanguage(language: Language): void {
  document.documentElement.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
}

export function setLanguage(language: Language): void {
  languageStore.set(language);
  writeLocal(LANGUAGE_KEY, language);
}

export function setThemePreference(preference: ThemePreference): void {
  themeStore.set(preference);
  writeLocal(THEME_KEY, preference);
}

/** Applies stored preferences to the document and keeps it in sync with later changes. */
export function initialisePreferences(): void {
  applyTheme();
  applyLanguage(languageStore.get());
  themeStore.subscribe(() => applyTheme());
  languageStore.subscribe(() => applyLanguage(languageStore.get()));
  darkQuery?.addEventListener('change', () => {
    if (themeStore.get() === 'system') {
      applyTheme();
    }
  });
}
