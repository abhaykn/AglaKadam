import { Printer } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export type CredentialSlip =
  | { kind: 'staff'; fullName: string; mobile: string; temporaryPassword: string }
  | { kind: 'family'; fullName: string; learnerCode: string; pin: string };

function formatLearnerCode(code: string): string {
  return `${code.slice(0, 5)} ${code.slice(5)}`;
}

function Slip({ slip }: { slip: CredentialSlip }) {
  const { t } = useTranslation();
  const address = window.location.origin;
  return (
    <article className="ak-slip rounded-xl border border-dashed border-border-strong p-4">
      <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {t('common.appName')} ·{' '}
        {slip.kind === 'staff' ? t('slips.staffHeading') : t('slips.familyHeading')}
      </p>
      <p className="mt-2 text-lg font-semibold text-fg">{slip.fullName}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {slip.kind === 'staff' ? (
          <>
            <dt className="text-fg-muted">{t('slips.signInId')}</dt>
            <dd className="font-mono text-base font-semibold text-fg">{slip.mobile}</dd>
            <dt className="text-fg-muted">{t('slips.temporaryPassword')}</dt>
            <dd className="font-mono text-base font-semibold tracking-wider text-fg">
              {slip.temporaryPassword}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-fg-muted">{t('slips.learnerCode')}</dt>
            <dd className="font-mono text-base font-semibold text-fg">
              {formatLearnerCode(slip.learnerCode)}
            </dd>
            <dt className="text-fg-muted">{t('slips.pin')}</dt>
            <dd className="font-mono text-base font-semibold tracking-widest text-fg">
              {slip.pin}
            </dd>
          </>
        )}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-fg-muted">
        {slip.kind === 'staff'
          ? t('slips.staffInstructions', { address })
          : t('slips.familyInstructions', { address })}
      </p>
    </article>
  );
}

interface CredentialSlipsDialogProps {
  slips: CredentialSlip[];
  onClose: () => void;
}

/**
 * Shows newly issued passwords or PINs once, ready to print. They are never stored in readable form,
 * so closing the dialog without printing means issuing them again.
 */
export function CredentialSlipsDialog({ slips, onClose }: CredentialSlipsDialogProps) {
  const { t } = useTranslation();
  const open = slips.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        title={t('slips.title', { count: slips.length })}
        description={t('slips.description')}
      >
        <div className="space-y-4">
          <Alert tone="warning">{t('slips.shownOnce')}</Alert>
          <div className="space-y-3">
            {slips.map((slip, index) => (
              <Slip key={`${slip.fullName}-${String(index)}`} slip={slip} />
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('slips.done')}
            </Button>
            <Button onClick={() => window.print()} leadingIcon={<Printer aria-hidden="true" />}>
              {t('slips.print')}
            </Button>
          </div>
        </div>
      </DialogContent>
      {open
        ? createPortal(
            <div className="ak-print-root" aria-hidden="true">
              {slips.map((slip, index) => (
                <Slip key={`${slip.fullName}-${String(index)}`} slip={slip} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </Dialog>
  );
}
