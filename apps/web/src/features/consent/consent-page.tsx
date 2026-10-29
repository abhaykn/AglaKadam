import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, CircleAlert, CloudOff, FileSignature, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  classDetailsQuery,
  classRosterQuery,
  rollOn,
  type ClassDetails,
  type RosterEntry,
} from '@/features/attendance/attendance-api';
import { dayInIndia, formatDay } from '@/features/attendance/dates';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { reasonFor } from '@/features/offline/sync-reasons';
import { useWaitingOfClass, type WaitingOf } from '@/features/offline/use-waiting-of-class';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  audioConsentChange,
  audioConsentQuery,
  recordAudioConsent,
  type AudioConsentChange,
  type ConsentDecision,
} from './consent-api';

type Method = AudioConsentChange['method'];

interface DecisionFormProps {
  child: RosterEntry;
  details: ClassDetails;
  guardianName: string;
  onDone: () => void;
}

function DecisionForm({ child, details, guardianName: knownName, onDone }: DecisionFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [guardianName, setGuardianName] = useState(knownName);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [method, setMethod] = useState<Method>('paper_form');
  const [isSaving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const nameError =
    guardianName.trim().length === 0
      ? t('consent.form.nameRequired')
      : guardianName.trim().length > 120
        ? t('consent.form.nameTooLong')
        : null;

  const save = async () => {
    if (nameError || granted === null) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const { queued } = await recordAudioConsent(
        {
          id: crypto.randomUUID(),
          studentId: child.studentId,
          classSectionId: details.id,
          granted,
          guardianName: guardianName.trim(),
          method,
          decidedAt: new Date().toISOString(),
          childName: child.fullName,
          classLabel: { grade: details.grade, section: details.section },
        },
        queryClient,
      );
      toast.success(
        queued && !isOnline
          ? t('consent.savedOnDevice', { name: child.fullName })
          : t('consent.saved', { name: child.fullName }),
      );
      onDone();
    } catch {
      toast.error(isOnline ? t('consent.saveFailed') : t('consent.needsNetwork'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <Field label={t('consent.form.guardianName')} error={showErrors ? nameError : null}>
        <Input
          value={guardianName}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => setGuardianName(event.target.value)}
        />
      </Field>
      <ChoiceGroup
        label={t('consent.form.decision')}
        value={granted === null ? null : granted ? 'granted' : 'refused'}
        onChange={(value) => setGranted(value === 'granted')}
        options={[
          { value: 'granted', label: t('consent.form.granted') },
          { value: 'refused', label: t('consent.form.refused') },
        ]}
        error={showErrors && granted === null ? t('consent.form.decisionRequired') : null}
      />
      <ChoiceGroup
        label={t('consent.form.method')}
        value={method}
        onChange={setMethod}
        options={[
          { value: 'paper_form', label: t('consent.form.paperForm') },
          { value: 'in_person', label: t('consent.form.inPerson') },
        ]}
      />
      <Button type="submit" size="lg" className="w-full" isLoading={isSaving}>
        {t('consent.form.save')}
      </Button>
    </form>
  );
}

function StatusBadge({
  decision,
  waiting,
}: {
  decision: ConsentDecision | undefined;
  waiting: WaitingOf<AudioConsentChange> | undefined;
}) {
  const { t, i18n } = useTranslation();
  if (waiting) {
    return waiting.state === 'failed' ? (
      <Badge tone="danger">{t('consent.status.refusedByServer')}</Badge>
    ) : (
      <Badge tone="warning">
        {waiting.payload.granted
          ? t('consent.status.grantedOnDevice')
          : t('consent.status.refusedOnDevice')}
      </Badge>
    );
  }
  if (!decision) {
    return <Badge>{t('consent.status.none')}</Badge>;
  }
  const date = formatDay(dayInIndia(decision.recordedAt), i18n.language);
  return decision.granted ? (
    <Badge tone="success">{t('consent.status.granted', { date })}</Badge>
  ) : (
    <Badge tone="neutral">{t('consent.status.refused', { date })}</Badge>
  );
}

/** Recording guardians' decisions about audio checks for one class. */
export function ConsentPage({ classSectionId }: { classSectionId: string }) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const details = useQuery(classDetailsQuery(classSectionId));
  const roster = useQuery(classRosterQuery(classSectionId));
  const consent = useQuery(audioConsentQuery(classSectionId));
  const waiting = useWaitingOfClass(audioConsentChange, classSectionId);
  const [editing, setEditing] = useState<RosterEntry | null>(null);
  useDocumentTitle(t('consent.title'));

  const roll = useMemo(() => rollOn(roster.data ?? [], todayInIndia()), [roster.data]);
  // The latest decision waiting on the device for each child, which is the one that will be in force.
  const waitingByChild = useMemo(() => {
    const latest = new Map<string, WaitingOf<AudioConsentChange>>();
    for (const entry of waiting.entries) {
      latest.set(entry.payload.studentId, entry);
    }
    return latest;
  }, [waiting.entries]);
  const consented = roll.filter((child) => {
    const pending = waitingByChild.get(child.studentId);
    return pending
      ? pending.payload.granted
      : consent.data?.decisions[child.studentId]?.granted === true;
  }).length;

  const cannotLoad = (query: { data: unknown; isError: boolean; fetchStatus: string }) =>
    query.data === undefined && (query.isError || query.fetchStatus === 'paused' || !isOnline);

  return (
    <div className="container-page space-y-5 py-8">
      <Link
        to="/app/pulse/$classId"
        params={{ classId: classSectionId }}
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('pulse.backToList')}
      </Link>
      <PageHeader
        title={
          details.data
            ? t('consent.titleFor', {
                class: classLabel(t, details.data.grade, details.data.section),
              })
            : t('consent.title')
        }
        description={t('consent.description')}
      />
      {(cannotLoad(details) || cannotLoad(roster) || cannotLoad(consent)) && !isOnline ? (
        <EmptyState
          icon={CloudOff}
          title={t('consent.notOnDevice.title')}
          description={t('consent.notOnDevice.body')}
        />
      ) : (
        <QueryState
          isPending={
            details.isPending || roster.isPending || consent.isPending || !waiting.isLoaded
          }
          isError={
            (details.isError && !details.data) ||
            (roster.isError && !roster.data) ||
            (consent.isError && !consent.data)
          }
          onRetry={() => {
            void details.refetch();
            void roster.refetch();
            void consent.refetch();
          }}
        >
          {details.data === null ? (
            <EmptyState icon={CircleAlert} title={t('attendance.classNotFound')} />
          ) : roll.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('attendance.emptyRoll.title')}
              description={t('attendance.emptyRoll.body')}
            />
          ) : details.data ? (
            <div className="space-y-4">
              <Alert tone="info">{t('consent.howItWorks')}</Alert>
              <p className="text-sm text-fg tabular-nums" aria-live="polite">
                {t('consent.coverage', { consented, total: roll.length })}
              </p>
              <Card>
                <ul className="divide-y divide-border">
                  {roll.map((child) => {
                    const pending = waitingByChild.get(child.studentId);
                    return (
                      <li
                        key={child.studentId}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium text-fg">{child.fullName}</p>
                          <p className="text-xs text-fg-muted tabular-nums">{child.studentCode}</p>
                          <StatusBadge
                            decision={consent.data?.decisions[child.studentId]}
                            waiting={pending}
                          />
                          {pending?.state === 'failed' && pending.error ? (
                            <p className="text-sm text-danger">{reasonFor(pending.error, t)}</p>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing(child)}
                          leadingIcon={<FileSignature aria-hidden="true" />}
                          aria-label={t('consent.recordFor', { name: child.fullName })}
                        >
                          {t('consent.record')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          ) : null}
        </QueryState>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      >
        {editing && details.data ? (
          <DialogContent
            title={t('consent.form.title', { name: editing.fullName })}
            description={t('consent.form.description')}
          >
            <DecisionForm
              key={editing.studentId}
              child={editing}
              details={details.data}
              guardianName={
                consent.data?.decisions[editing.studentId]?.guardianName ??
                consent.data?.guardianNames[editing.studentId] ??
                ''
              }
              onDone={() => setEditing(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
