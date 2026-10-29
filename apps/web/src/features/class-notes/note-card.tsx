import { FileText, ImageIcon, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatDay } from '@/features/attendance/dates';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { getSupabase } from '@/lib/supabase';
import type { NoteAttachment } from './note-api';
import { CLASS_NOTES_BUCKET, type NoteKind } from './note-change';
import { formatBytes, formatNoteTime } from './note-format';

/** A note as a list shows it, sent or still waiting on the phone. */
export interface ShownNote {
  id: string;
  kind: NoteKind;
  body: string;
  dueOn: string | null;
  authorName: string | null;
  /** When it was written or received. */
  at: string;
  attachment: NoteAttachment | null;
  /** The name of a file still waiting on the phone with its note. */
  waitingFile: string | null;
}

type FileState =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error' };

/**
 * Opens a note's file from private storage, only when asked for: a picture in a dialog, a PDF to
 * save and open on the phone. It is kept in memory while the page is open.
 */
function AttachmentButton({ attachment }: { attachment: NoteAttachment }) {
  const { t, i18n } = useTranslation();
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<FileState>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const isPicture = attachment.type !== 'application/pdf';
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (state.kind === 'ready') {
        URL.revokeObjectURL(state.url);
      }
    },
    [state],
  );

  const show = (url: string) => {
    if (isPicture) {
      setOpen(true);
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name ?? 'note.pdf';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  };

  const load = async () => {
    if (state.kind === 'ready') {
      show(state.url);
      return;
    }
    setState({ kind: 'loading' });
    const { data, error } = await getSupabase()
      .storage.from(CLASS_NOTES_BUCKET)
      .download(attachment.path);
    if (!mounted.current) {
      return;
    }
    if (error) {
      setState({ kind: 'error' });
      return;
    }
    const url = URL.createObjectURL(data);
    setState({ kind: 'ready', url });
    show(url);
  };

  const label = isPicture ? t('notes.file.picture') : t('notes.file.pdf');
  return (
    <div className="space-y-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={state.kind === 'loading' || (!isOnline && state.kind !== 'ready')}
        onClick={() => void load()}
      >
        {state.kind === 'loading' ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : isPicture ? (
          <ImageIcon aria-hidden="true" />
        ) : (
          <FileText aria-hidden="true" />
        )}
        {label}
        <span className="text-fg-muted">{formatBytes(attachment.bytes, i18n.language)}</span>
      </Button>
      {!isOnline && state.kind !== 'ready' ? (
        <p className="text-sm text-fg-muted">{t('notes.file.offline')}</p>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {t('notes.file.failed')}
        </p>
      ) : null}
      {state.kind === 'ready' && isPicture ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title={attachment.name ?? label} className="max-w-3xl">
            <img
              src={state.url}
              alt={t('notes.file.pictureAlt')}
              className="mt-4 max-h-[70dvh] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** One note: what kind it is, when homework is due, the text, who sent it and its file. */
export function NoteCard({
  note,
  status,
  actions,
}: {
  note: ShownNote;
  /** For example whether it still waits on the phone. */
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <article className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {note.kind === 'homework' ? (
          <Badge tone="brand">{t('notes.kind.homework')}</Badge>
        ) : (
          <Badge>{t('notes.kind.message')}</Badge>
        )}
        {note.dueOn ? (
          <Badge tone="warning">
            {t('notes.dueOn', { date: formatDay(note.dueOn, i18n.language) })}
          </Badge>
        ) : null}
        {status}
      </div>
      <p className="leading-relaxed break-words whitespace-pre-wrap text-fg">{note.body}</p>
      {note.attachment ? <AttachmentButton attachment={note.attachment} /> : null}
      {note.waitingFile ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <FileText className="size-4" aria-hidden="true" />
          {note.waitingFile}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {note.authorName
            ? t('notes.byAt', {
                name: note.authorName,
                time: formatNoteTime(note.at, i18n.language),
              })
            : formatNoteTime(note.at, i18n.language)}
        </p>
        {actions}
      </div>
    </article>
  );
}
