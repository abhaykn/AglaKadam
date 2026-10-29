import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { languageStore } from '@/features/preferences/preferences';
import en from './locales/en.json';
import hi from './locales/hi.json';

export const resources = {
  en: { translation: en },
  hi: { translation: hi },
} as const;

/** Initialises translations synchronously so the first render already uses the right language. */
export function initialiseI18n(): typeof i18next {
  void i18next.use(initReactI18next).init({
    resources,
    lng: languageStore.get(),
    fallbackLng: 'en',
    supportedLngs: ['en', 'hi'],
    initAsync: false,
    interpolation: { escapeValue: false },
  });

  languageStore.subscribe(() => {
    void i18next.changeLanguage(languageStore.get());
  });

  return i18next;
}
