import { useTranslation } from 'react-i18next';

interface Named {
  name_en: string;
  name_hi?: string | null;
}

/** Picks the Hindi name when the interface is in Hindi and one is recorded, otherwise English. */
export function useLocalisedName(): (named: Named) => string {
  const { i18n } = useTranslation();
  const hindi = i18n.language === 'hi';
  return (named) => (hindi && named.name_hi ? named.name_hi : named.name_en);
}
