import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Megaphone, Paperclip, Send, Trash2, X } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInIndia } from '@shared/accounts.ts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { addDays } from '@/features/attendance/dates';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { reasonFor } from '@/features/offline/sync-reasons';
import { useWaitingOfClass } from '@/features/offline/use-waiting-of-class';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { getSupabase } from '@/lib/supabase';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { classNotesQuery, useRemoveNote, useSendNote, type ClassNote } from './note-api';
import { NoteCard, type ShownNote } from './note-card';
import { formatBytes } from './note-format';
import {
  HOMEWORK_DAYS,
  NOTE_BODY_LIMIT,
  noteRemoveChange,
  noteSendChange,
  removeUnsentFile,
  type NoteKind,
  type NoteSendChange,
} from './note-change';
import { prepareNoteFile, type FileProblem, type PreparedFile } from './note-file';

/** How many children of a class have a family sign-in, and so whose families read its notes. */
function familyReachQuery(classSectionId: string) {
  return queryOptions({
    queryKey: ['class-family-reach', classSectionId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ children: number; families: number }> => {
      const { data, error } = await getSupabase()
        .from('enrolments')
        .select('students!inner(id, status, family_sign_in_active)')
        .eq('class_section_id', classSectionId)
        .is('ended_on', null)
        .eq('students.status', 'active');
      if (error) {
        throw error;
      }
      return {
        children: data.length,
        families: data.filter((row) => row.students.family_sign_in_active).length,
      };
    },
  });
}

function shownOf(note: ClassNote): ShownNote {
  return {
    id: note.id,
    kind: note.kind,
    body: note.body,
    dueOn: note.dueOn,
    authorName: note.authorName,
    at: note.createdAt,
    attachment: note.attachment,
    waitingFile: null,
  };
}

/** A teacher's notes and homework for the families of a class: writing them, and those sent. */
export function ClassNotesPage({ classSectionId }: { classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const localise = useLocalisedName();
  const details = useQuery(classDetailsQuery(classSectionId));
  const notes = useQuery(classNotesQuery(classSectionId));
  const reach = useQuery(familyReachQuery(classSectionId));
  const waitingSends = useWaitingOfClass(noteSendChange, classSectionId);
  const waitingRemoves = useWaitingOfClass(noteRemoveChange, classSectionId);
  const sendNote = useSendNote();
  const removeNote = useRemoveNote();
  useDocumentTitle(t('notes.title'));

  const today = todayInIndia();
  const [kind, setKind] = useState<NoteKind>('message');
  const [body, setBody] = useState('');
  const [dueOn, setDueOn] = useState(addDays(today, 1));
  const [file, setFile] = useState<PreparedFile | null>(null);
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [bodyError, setBodyError] = useState(false);
  const [removing, setRemoving] = useState<ClassNote | null>(null);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);

  const lastDue = addDays(today, HOMEWORK_DAYS);
  const dueValid = dueOn >= today && dueOn <= lastDue;

  const chooseFile = async (chosen: File | undefined) => {
    if (!chosen) {
      return;
    }
    setPreparing(true);
    setFileProblem(null);
    const prepared = await prepareNoteFile(chosen);
    setPreparing(false);
    if ('problem' in prepared) {
      setFile(null);
      setFileProblem(prepared.problem);
    } else {
      setFile(prepared.file);
    }
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!details.data) {
      return;
    }
    if (body.trim() === '') {
      setBodyError(true);
      return;
    }
    if (kind === 'homework' && !dueValid) {
      return;
    }
    setSending(true);
    const outcome = await sendNote({
      id: draftId,
      classSectionId,
      schoolId: details.data.school.id,
      kind,
      body,
      dueOn: kind === 'homework' ? dueOn : null,
      file,
    });
    setSending(false);
    if (outcome !== 'failed') {
      setDraftId(crypto.randomUUID());
      setBody('');
      setFile(null);
      setFileProblem(null);
      setKind('message');
      setDueOn(addDays(today, 1));
      if (fileInput.current) {
        fileInput.current.value = '';
      }
      toast.success(outcome === 'kept' ? t('notes.kept') : t('notes.sentNow'));
    }
  };

  // A removal the server refused leaves the note shown, marked, since families still see it.
  const removedIds = new Set(
    waitingRemoves.entries
      .filter((entry) => entry.state !== 'failed')
      .map((entry) => entry.payload.noteId),
  );
  const failedRemovals = new Map(
    waitingRemoves.entries
      .filter((entry) => entry.state === 'failed')
      .map((entry) => [entry.payload.noteId, entry] as const),
  );
  const discard = (outboxId: string, note: NoteSendChange) => {
    void offlineRuntime
      .discard(outboxId)
      // The file may have reached storage before the note was refused; without a network it
      // stays, and storage never shows it to families without a note. A note that reached the
      // server meanwhile keeps its file.
      .then((removed) => (removed ? removeUnsentFile(note, getSupabase()) : undefined))
      .catch(() => toast.error(t('sync.actionFailed')));
  };
  const sent = (notes.data ?? []).filter((note) => !removedIds.has(note.id));
  const sentIds = new Set(sent.map((note) => note.id));
  const waiting = waitingSends.entries
    .filter((entry) => !sentIds.has(entry.payload.id))
    .sort((a, b) => b.payload.writtenAt.localeCompare(a.payload.writtenAt));

  const className = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('exams.classFallback');

  return (
    <div className="container-page space-y-6 py-8">
      <Link
        to="/app/teacher"
        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('notes.back')}
      </Link>
      <PageHeader
        title={t('notes.title')}
        description={
          details.data
            ? t('notes.description', { class: className, school: localise(details.data.school) })
            : undefined
        }
      />

      {reach.data && reach.data.children > 0 ? (
        <Alert tone={reach.data.families < reach.data.children ? 'info' : 'success'}>
          {t('notes.reach', { families: reach.data.families, count: reach.data.children })}
        </Alert>
      ) : null}

      <Card aria-labelledby="write-note">
        <CardHeader titleId="write-note" title={t('notes.write.title')} />
        <CardBody>
          <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
            <ChoiceGroup
              label={t('notes.write.kind')}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'message', label: t('notes.kind.message') },
                { value: 'homework', label: t('notes.kind.homework') },
              ]}
            />
            <Field
              label={kind === 'homework' ? t('notes.write.homeworkBody') : t('notes.write.body')}
              hint={t('notes.write.count', { length: body.length, limit: NOTE_BODY_LIMIT })}
              error={bodyError ? t('notes.write.bodyRequired') : undefined}
            >
              <Textarea
                rows={4}
                maxLength={NOTE_BODY_LIMIT}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setBodyError(false);
                }}
              />
            </Field>
            {kind === 'homework' ? (
              <Field
                label={t('notes.write.dueOn')}
                error={dueValid ? undefined : t('notes.write.dueOnRange', { days: HOMEWORK_DAYS })}
              >
                <Input
                  type="date"
                  value={dueOn}
                  min={today}
                  max={lastDue}
                  onChange={(event) => setDueOn(event.target.value)}
                  className="sm:max-w-56"
                />
              </Field>
            ) : null}
            <div className="space-y-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />
              {file ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <Paperclip className="size-4 text-fg-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {file.name ?? t('notes.file.picture')}
                  </span>
                  <span className="text-sm text-fg-muted">
                    {formatBytes(file.blob.size, i18n.language)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('notes.write.removeFile')}
                    onClick={() => {
                      setFile(null);
                      if (fileInput.current) {
                        fileInput.current.value = '';
                      }
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={preparing}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip aria-hidden="true" />
                  {preparing ? t('notes.write.preparing') : t('notes.write.addFile')}
                </Button>
              )}
              <p className="text-sm text-fg-muted">{t('notes.write.fileHint')}</p>
              {fileProblem ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {t(`notes.write.fileProblem.${fileProblem}`)}
                </p>
              ) : null}
            </div>
            <Button type="submit" disabled={sending || preparing || !details.data}>
              <Send aria-hidden="true" />
              {t('notes.write.send')}
            </Button>
          </form>
        </CardBody>
      </Card>

      <section aria-labelledby="sent-notes" className="space-y-3">
        <h2 id="sent-notes" className="text-lg font-semibold text-fg">
          {t('notes.sent')}
        </h2>
        {waiting.map((entry) => (
          <NoteCard
            key={entry.outboxId}
            note={{
              id: entry.payload.id,
              kind: entry.payload.kind,
              body: entry.payload.body,
              dueOn: entry.payload.dueOn,
              authorName: null,
              at: entry.payload.writtenAt,
              attachment: null,
              waitingFile: entry.payload.file
                ? (entry.payload.file.name ?? t('notes.file.picture'))
                : null,
            }}
            status={
              entry.state === 'failed' ? (
                <>
                  <Badge tone="danger">{t('notes.status.failed')}</Badge>
                  {entry.error ? (
                    <span className="text-sm text-danger">{reasonFor(entry.error, t)}</span>
                  ) : null}
                </>
              ) : (
                <Badge tone="warning">{t('notes.status.waiting')}</Badge>
              )
            }
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => discard(entry.outboxId, entry.payload)}
              >
                <Trash2 aria-hidden="true" />
                {t('notes.discard')}
              </Button>
            }
          />
        ))}
        <QueryState
          isPending={notes.isPending}
          isError={notes.isError}
          onRetry={() => void notes.refetch()}
        >
          {sent.length === 0 && waiting.length === 0 ? (
            <Card>
              <EmptyState
                icon={Megaphone}
                title={t('notes.empty.title')}
                description={t('notes.empty.body')}
              />
            </Card>
          ) : (
            sent.map((note) => (
              <NoteCard
                key={note.id}
                note={shownOf(note)}
                status={
                  failedRemovals.has(note.id) ? (
                    <>
                      <Badge tone="danger">{t('notes.status.removeFailed')}</Badge>
                      {failedRemovals.get(note.id)?.error ? (
                        <span className="text-sm text-danger">
                          {reasonFor(
                            failedRemovals.get(note.id)?.error ?? { code: '', message: '' },
                            t,
                          )}
                        </span>
                      ) : null}
                    </>
                  ) : null
                }
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(note)}>
                    <Trash2 aria-hidden="true" />
                    {t('notes.remove')}
                  </Button>
                }
              />
            ))
          )}
        </QueryState>
      </section>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent
          title={t('notes.removeDialog.title')}
          description={t('notes.removeDialog.body')}
        >
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) {
                  void removeNote(removing);
                }
                setRemoving(null);
              }}
            >
              <Trash2 aria-hidden="true" />
              {t('notes.remove')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
