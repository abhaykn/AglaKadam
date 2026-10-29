import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, CloudOff, KeyRound, QrCode as QrCodeIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { monthOf, pulseWeekCodesQuery, type WeekCode } from './pulse-api';
import { QrCode } from './qr-code';
import { weekUnlockCode } from './week-batch';

/** The CRP's QR codes, to unlock a week of Pulse on a teacher's phone during a visit. */
export function CrpCodesPage() {
  const { t } = useTranslation();
  const localise = useLocalisedName();
  const isOnline = useOnlineStatus();
  const codes = useQuery(pulseWeekCodesQuery());
  const [shown, setShown] = useState<WeekCode | null>(null);
  useDocumentTitle(t('pulse.codes.title'));
  const today = todayInIndia();
  // Only this month's weeks that have opened can be unlocked: a teacher's check needs its week to
  // have begun, and the codes kept from last month (or drawn ahead for the next) would repeat the
  // same week numbers.
  const open = (codes.data ?? []).filter(
    (code) => code.opensOn >= monthOf(today) && code.opensOn <= today,
  );
  const schools = [...new Map(open.map((code) => [code.school.id, code.school])).values()];

  return (
    <div className="container-page space-y-5 py-8">
      <Link
        to="/app/crp"
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('pulse.codes.back')}
      </Link>
      <PageHeader title={t('pulse.codes.title')} description={t('pulse.codes.description')} />
      {codes.data === undefined && !isOnline ? (
        <EmptyState
          icon={CloudOff}
          title={t('pulse.codes.notOnDevice.title')}
          description={t('pulse.codes.notOnDevice.body')}
        />
      ) : (
        <QueryState
          isPending={codes.isPending}
          isError={codes.isError && !codes.data}
          onRetry={() => void codes.refetch()}
        >
          {open.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title={t('pulse.codes.empty.title')}
              description={t('pulse.codes.empty.body')}
            />
          ) : (
            <div className="space-y-4">
              <Alert tone="info">{t('pulse.codes.howTo')}</Alert>
              {schools.map((school) => (
                <Card key={school.id} className="p-0">
                  <p className="border-b border-border px-5 py-3 font-semibold text-fg">
                    {localise(school)}
                  </p>
                  <ul className="divide-y divide-border">
                    {open
                      .filter((code) => code.school.id === school.id)
                      .map((code) => (
                        <li
                          key={`${code.cycleId}:${String(code.week)}`}
                          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                        >
                          <p className="text-fg">
                            {classLabel(t, code.classLabel.grade, code.classLabel.section)}
                            {' · '}
                            {t('pulse.codes.week', { week: code.week })}
                          </p>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setShown(code)}
                            leadingIcon={<QrCodeIcon aria-hidden="true" />}
                          >
                            {t('pulse.codes.show')}
                          </Button>
                        </li>
                      ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </QueryState>
      )}

      <Dialog
        open={shown !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShown(null);
          }
        }}
      >
        {shown ? (
          <DialogContent
            title={t('pulse.codes.dialogTitle', {
              class: classLabel(t, shown.classLabel.grade, shown.classLabel.section),
              week: shown.week,
            })}
            description={t('pulse.codes.dialogBody')}
          >
            <div className="flex justify-center rounded-2xl bg-white p-4">
              <QrCode
                text={weekUnlockCode(shown.cycleId, shown.week, shown.key)}
                label={t('pulse.codes.qrLabel')}
              />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
