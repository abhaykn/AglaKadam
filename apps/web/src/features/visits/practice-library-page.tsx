import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/ui/back-link';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/features/workspaces/page-header';
import { useDocumentTitle } from '@/lib/use-document-title';
import { textIn, type FocusArea } from './observation-bank';
import { PRACTICES } from './practice-library';
import { PracticeDetails } from './visit-ui';

const AREAS: FocusArea[] = ['reading', 'english', 'inclusion', 'classroom'];

/** Every practice of the library, for CRPs and teachers alike; it works without a network. */
export function PracticeLibraryPage() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('visits.library.title'));
  return (
    <div className="container-page space-y-6 py-8">
      <BackLink to="/app">{t('app.home')}</BackLink>
      <PageHeader title={t('visits.library.title')} description={t('visits.library.description')} />
      {AREAS.map((area) => {
        const ofArea = PRACTICES.filter((entry) => entry.area === area);
        if (ofArea.length === 0) {
          return null;
        }
        return (
          <Card key={area} aria-labelledby={`area-${area}`}>
            <CardHeader titleId={`area-${area}`} title={t(`visits.area.${area}`)} />
            <div className="divide-y divide-border">
              {ofArea.map((entry) => (
                <details key={entry.code} className="group px-5 py-4">
                  <summary className="cursor-pointer font-medium text-fg">
                    {textIn(entry.title, i18n.language)}
                  </summary>
                  <PracticeDetails practice={entry} className="mt-3" />
                </details>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
