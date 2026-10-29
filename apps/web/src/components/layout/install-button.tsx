import { Download, Share, SquarePlus, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { installStore, promptInstall } from '@/features/pwa/install';
import { useStore } from '@/lib/store';

/**
 * Offers installation only when it is actually possible: the native prompt on Chromium browsers,
 * or step-by-step guidance on iOS Safari. Nothing is rendered once the app is installed.
 */
export function InstallButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const canPrompt = useStore(installStore, (state) => state.canPrompt);
  const isInstalled = useStore(installStore, (state) => state.isInstalled);
  const needsIosGuide = useStore(installStore, (state) => state.needsManualIosInstall);
  const [isGuideOpen, setGuideOpen] = useState(false);

  if (isInstalled || (!canPrompt && !needsIosGuide)) {
    return null;
  }

  const label = t('common.installApp');

  const handleClick = (): void => {
    if (canPrompt) {
      void promptInstall();
    } else {
      setGuideOpen(true);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size={compact ? 'icon-sm' : 'sm'}
        onClick={handleClick}
        aria-label={compact ? label : undefined}
        leadingIcon={<Download aria-hidden="true" />}
      >
        {compact ? null : label}
      </Button>
      <Dialog open={isGuideOpen} onOpenChange={setGuideOpen}>
        <DialogContent
          placement="bottom"
          title={t('install.iosTitle')}
          description={t('install.iosIntro')}
          className="mx-auto max-w-lg"
        >
          <ol className="space-y-4">
            {[
              { icon: Share, text: t('install.iosStepShare') },
              { icon: SquarePlus, text: t('install.iosStepAdd') },
              { icon: Smartphone, text: t('install.iosStepOpen') },
            ].map(({ icon: Icon, text }, index) => (
              <li key={text} className="flex items-center gap-3.5">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-[0.9375rem] text-fg">
                  <span className="mr-1.5 font-semibold text-fg-subtle">{index + 1}.</span>
                  {text}
                </span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
