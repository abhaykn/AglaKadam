import { Camera, LoaderCircle, ScanText } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { prepareNoteFile } from '@/features/class-notes/note-file';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { base64Of, readOrder, sahayakError, type OrderTask } from './sahayak-api';

interface Row extends OrderTask {
  keep: boolean;
}

type State =
  | { kind: 'choose' }
  | { kind: 'reading' }
  | { kind: 'review'; rows: Row[]; issuer: string | null }
  | { kind: 'unreadable' }
  | { kind: 'error'; message: string };

/**
 * Reads the tasks in a photo of an order or circular. The photo is made smaller on the phone, sent
 * once and kept nowhere; the CRP checks every task, its title and its deadline, before the chosen
 * ones are added to the cluster's tasks.
 */
export function OrderReader({ onAdd }: { onAdd: (tasks: OrderTask[]) => void }) {
  const { t, i18n } = useTranslation();
  const isOnline = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: 'choose' });
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File | undefined) => {
    // Cleared at once, so that the same photo can be chosen again whatever happens to this one.
    if (input.current) {
      input.current.value = '';
    }
    if (!file) {
      return;
    }
    setState({ kind: 'reading' });
    try {
      const prepared = await prepareNoteFile(file);
      const contentType = 'problem' in prepared ? null : prepared.file.contentType;
      if ('problem' in prepared || contentType === null || contentType === 'application/pdf') {
        setState({ kind: 'error', message: t('sahayak.order.notPicture') });
        return;
      }
      const answer = await readOrder(
        { base64: await base64Of(prepared.file.blob), mediaType: contentType },
        i18n.language === 'en' ? 'en' : 'hi',
      );
      if (!answer.readable || answer.tasks.length === 0) {
        setState({ kind: 'unreadable' });
        return;
      }
      setState({
        kind: 'review',
        issuer: answer.issuer,
        rows: answer.tasks.map((task) => ({ ...task, keep: true })),
      });
    } catch (error) {
      setState({ kind: 'error', message: sahayakError(error, t) });
    }
  };

  const change = (index: number, patch: Partial<Row>) =>
    setState((current) =>
      current.kind === 'review'
        ? {
            ...current,
            rows: current.rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
          }
        : current,
    );

  const chosen =
    state.kind === 'review' ? state.rows.filter((row) => row.keep && row.title.trim()) : [];

  return (
    <>
      <Button
        variant="secondary"
        disabled={!isOnline}
        onClick={() => {
          setState({ kind: 'choose' });
          setOpen(true);
        }}
      >
        <ScanText aria-hidden="true" />
        {t('sahayak.order.open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t('sahayak.order.title')}
          description={t('sahayak.order.description')}
          placement="bottom"
          className="overflow-y-auto"
        >
          <div className="mt-4 space-y-4">
            <input
              ref={input}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void read(event.target.files?.[0])}
            />
            {state.kind === 'choose' || state.kind === 'unreadable' || state.kind === 'error' ? (
              <div className="space-y-3">
                {state.kind === 'unreadable' ? (
                  <Alert tone="warning">{t('sahayak.order.unreadable')}</Alert>
                ) : null}
                {state.kind === 'error' ? <Alert tone="danger">{state.message}</Alert> : null}
                <Button onClick={() => input.current?.click()}>
                  <Camera aria-hidden="true" />
                  {t('sahayak.order.choose')}
                </Button>
                <p className="text-sm text-fg-muted">{t('sahayak.order.privacy')}</p>
              </div>
            ) : null}
            {state.kind === 'reading' ? (
              <p className="inline-flex items-center gap-2 text-sm text-fg" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                {t('sahayak.order.reading')}
              </p>
            ) : null}
            {state.kind === 'review' ? (
              <div className="space-y-4">
                {state.issuer ? (
                  <p className="text-sm text-fg-muted">
                    {t('sahayak.order.from', { issuer: state.issuer })}
                  </p>
                ) : null}
                <p className="text-sm text-fg">{t('sahayak.order.check')}</p>
                <ul className="space-y-3">
                  {state.rows.map((row, index) => (
                    <li key={index} className="space-y-2 rounded-xl border border-border p-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-fg">
                        <input
                          type="checkbox"
                          className="size-5"
                          checked={row.keep}
                          onChange={(event) => change(index, { keep: event.target.checked })}
                        />
                        {t('sahayak.order.keep')}
                      </label>
                      <Field label={t('visits.tasks.titleLabel')}>
                        <Input
                          value={row.title}
                          maxLength={200}
                          onChange={(event) => change(index, { title: event.target.value })}
                        />
                      </Field>
                      <Field label={t('visits.tasks.dueLabel')}>
                        <Input
                          type="date"
                          value={row.dueOn ?? ''}
                          onChange={(event) => change(index, { dueOn: event.target.value || null })}
                        />
                      </Field>
                      {row.details ? <p className="text-sm text-fg-muted">{row.details}</p> : null}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={chosen.length === 0}
                    onClick={() => {
                      onAdd(
                        chosen.map((row) => ({
                          title: row.title.trim(),
                          details: row.details,
                          dueOn: row.dueOn,
                        })),
                      );
                      setOpen(false);
                    }}
                  >
                    {t('sahayak.order.add', { count: chosen.length })}
                  </Button>
                  <Button variant="ghost" onClick={() => setState({ kind: 'choose' })}>
                    {t('sahayak.order.again')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
