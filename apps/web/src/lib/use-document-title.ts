import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Keeps the browser tab title in sync with the current page and interface language.
 * Pages pass their own heading; the application name is appended automatically.
 */
export function useDocumentTitle(pageTitle?: string): void {
  const { t } = useTranslation();
  const appName = t('common.appName');

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · ${appName}` : appName;
  }, [pageTitle, appName]);
}
