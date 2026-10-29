import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LoaderCircle, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import {
  MicrophoneError,
  MicrophoneSession,
  MIN_RECORDING_MS,
  type MicrophoneProblem,
  type Recording,
} from '@/features/pulse/recorder';
import { ListenPlayer } from './listen-player';
import {
  noteUploaded,
  notePathOf,
  VISIT_NOTES_BUCKET,
  VOICE_NOTE_MS,
  visitDraftKey,
  type ClassLabel,
  type Visit,
  type VisitDraft,
} from './visit-change';
import { useKeepVoiceNote, visitNoteQuery } from './visit-api';

type State =
  | { kind: 'idle' }
  /** Waiting for the microphone, which may first ask the person for permission. */
  | { kind: 'opening' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'saving' }
  | { kind: 'problem'; problem: MicrophoneProblem | 'interrupted' | 'tooShort' | 'storage' };

function clock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The CRP's spoken note about the visit: up to two minutes, kept encrypted on the phone and
 * uploaded with the visit; the engine writes its transcript overnight. Only this CRP hears it.
 * `onRecordingChange` tells the page while the microphone is in use, so that it is not left.
 */
export function VoiceNoteCard({
  visit,
  label,
  onRecordingChange,
}: {
  visit: Visit;
  label: ClassLabel | null;
  onRecordingChange?: (recording: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const note = useQuery(visitNoteQuery(visit.id));
  const draft = useQuery<VisitDraft | null>({
    queryKey: visitDraftKey(visit.id),
    queryFn: () => null,
    enabled: false,
  });
  const keep = useKeepVoiceNote();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [language, setLanguage] = useState<'hi' | 'en'>(i18n.language === 'en' ? 'en' : 'hi');
  const [now, setNow] = useState(0);
  const session = useRef<MicrophoneSession | null>(null);
  const mounted = useRef(true);
  const [copied, setCopied] = useState(false);
  const busy = state.kind === 'opening' || state.kind === 'recording';

  useEffect(() => {
    onRecordingChange?.(busy);
  }, [busy, onRecordingChange]);

  useEffect(() => {
    if (state.kind !== 'recording') {
      return;
    }
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, [state.kind]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current?.close();
      session.current = null;
    };
  }, []);

  const finish = async (recording: Recording) => {
    session.current?.close();
    session.current = null;
    if (recording.durationMs < MIN_RECORDING_MS) {
      setState({ kind: 'problem', problem: 'tooShort' });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await keep(
        visit,
        {
          blob: recording.blob,
          durationMs: recording.durationMs,
          contentType: recording.format.contentType,
        },
        language,
        label,
      );
      setState({ kind: 'idle' });
    } catch {
      setState({ kind: 'problem', problem: 'storage' });
    }
  };

  const start = async () => {
    // A second tap while the permission prompt is open must not open a second microphone.
    if (state.kind === 'opening' || state.kind === 'recording' || session.current) {
      return;
    }
    setState({ kind: 'opening' });
    try {
      const opened = await MicrophoneSession.open();
      if (!mounted.current) {
        opened.close();
        return;
      }
      session.current = opened;
      opened.start((end) => {
        if (end.kind === 'limit') {
          void finish(end.recording);
        } else {
          opened.close();
          session.current = null;
          setState({ kind: 'problem', problem: 'interrupted' });
        }
      }, VOICE_NOTE_MS);
      const startedAt = performance.now();
      setNow(startedAt);
      setState({ kind: 'recording', startedAt });
    } catch (error) {
      setState({
        kind: 'problem',
        problem: error instanceof MicrophoneError ? error.problem : 'unsupported',
      });
    }
  };

  const stop = async () => {
    const current = session.current;
    if (!current) {
      return;
    }
    try {
      await finish(await current.stop());
    } catch {
      current.close();
      session.current = null;
      setState({ kind: 'problem', problem: 'interrupted' });
    }
  };

  const pending = draft.data?.pendingNote ?? null;
  const stored = note.data ?? null;
  const transcript = stored?.transcript ?? null;

  // The note may have been uploaded while no page was open (by the service worker): the server's
  // copy then replaces the one waiting on the phone.
  const storedPath = stored?.audioPath ?? null;
  useEffect(() => {
    if (pending && storedPath === notePathOf(visit.id, pending)) {
      noteUploaded(queryClient, visit.id, storedPath);
    }
  }, [pending, storedPath, queryClient, visit.id]);

  return (
    <Card>
      <CardHeader title={t('visits.note.title')} description={t('visits.note.body')} />
      <CardBody className="space-y-4">
        {!offlineRuntime.isAvailable ? (
          <Alert tone="warning">{t('visits.note.noStorage')}</Alert>
        ) : null}
        {draft.data?.noteMissing ? <Alert tone="warning">{t('visits.note.missing')}</Alert> : null}
        {state.kind === 'problem' ? (
          <Alert tone="danger" assertive>
            {state.problem === 'interrupted'
              ? t('pulse.interrupted')
              : state.problem === 'tooShort'
                ? t('pulse.tooShort')
                : state.problem === 'storage'
                  ? t('visits.note.noStorage')
                  : t(`pulse.microphone.${state.problem}`)}
          </Alert>
        ) : null}

        {state.kind === 'recording' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="danger" onClick={() => void stop()}>
              <Square aria-hidden="true" />
              {t('visits.note.stop')}
            </Button>
            <span className="text-sm text-fg tabular-nums" aria-live="off">
              {clock(now - state.startedAt)} / {clock(VOICE_NOTE_MS)}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('visits.note.language')} className="w-40">
              <Select
                value={language}
                onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'hi')}
              >
                <option value="hi">हिन्दी</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Button
              disabled={
                state.kind === 'saving' || state.kind === 'opening' || !offlineRuntime.isAvailable
              }
              onClick={() => void start()}
            >
              {state.kind === 'saving' || state.kind === 'opening' ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Mic aria-hidden="true" />
              )}
              {state.kind === 'opening'
                ? t('visits.note.opening')
                : pending || stored
                  ? t('visits.note.recordAgain')
                  : t('visits.note.record')}
            </Button>
          </div>
        )}

        {pending ? (
          <p className="text-sm text-fg-muted">
            {t('visits.note.waiting', { length: clock(pending.durationMs) })}
          </p>
        ) : stored ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              {transcript !== null
                ? t('visits.note.transcribed')
                : stored.audioAvailable
                  ? t('visits.note.uploaded', { length: clock(stored.durationMs) })
                  : t('visits.note.removed')}
            </p>
            {stored.audioAvailable ? (
              <ListenPlayer
                bucket={VISIT_NOTES_BUCKET}
                path={stored.audioPath}
                label={t('visits.note.title')}
              />
            ) : null}
            {transcript ? (
              <figure className="space-y-2">
                <blockquote className="rounded-lg bg-surface-muted p-3 text-sm whitespace-pre-wrap text-fg">
                  {transcript}
                </blockquote>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(transcript).then(() => setCopied(true));
                  }}
                >
                  <Copy aria-hidden="true" />
                  {copied ? t('visits.note.copied') : t('visits.note.copy')}
                </Button>
              </figure>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
