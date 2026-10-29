import { z } from 'zod';
import { registerChange } from '@/features/offline/change-registry';
import { isAlreadyStored, storageFailure } from '@/features/offline/storage-upload';
import { ChangeRejectedError, classifyFailure } from '@/features/offline/sync-errors';
import type { AppSupabaseClient } from '@/lib/supabase';

/**
 * Notes and homework a teacher sends to the families of a class, kept on the phone and sent when a
 * network is available, with the picture or PDF they carry. A note is never changed once sent; it
 * can be removed, and its file is removed with it.
 */

export const CLASS_NOTES_BUCKET = 'class-notes';
export const NOTE_KINDS = ['message', 'homework'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type NoteFileType = (typeof NOTE_FILE_TYPES)[number];
/** The largest file a note carries, as storage accepts it. */
export const NOTE_FILE_LIMIT = 1_048_576;
export const NOTE_BODY_LIMIT = 1000;
/** Homework is due within this many days. */
export const HOMEWORK_DAYS = 60;

/** Error code of a note whose file is no longer on the phone. */
export const NOTE_FILE_MISSING = 'note_file_missing';

export const noteExtension: Record<NoteFileType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const classNotesKey = (classSectionId: string) => ['class-notes', classSectionId] as const;
export const noteDedupeKey = (noteId: string) => `class-note:${noteId}`;
export const noteRemoveDedupeKey = (noteId: string) => `class-note-remove:${noteId}`;

const noteFileSchema = z.object({
  fileId: z.string().min(1).max(100),
  contentType: z.enum(NOTE_FILE_TYPES),
  name: z.string().min(1).max(120).nullable(),
  bytes: z.number().int().min(1).max(NOTE_FILE_LIMIT),
});

const noteSendSchema = z.object({
  id: z.guid(),
  classSectionId: z.guid(),
  schoolId: z.guid(),
  kind: z.enum(NOTE_KINDS),
  body: z.string().trim().min(1).max(NOTE_BODY_LIMIT),
  dueOn: z.iso.date().nullable(),
  file: noteFileSchema.nullable(),
  writtenAt: z.iso.datetime(),
});

export type NoteSendChange = z.infer<typeof noteSendSchema>;
export type NoteFile = z.infer<typeof noteFileSchema>;

/** Where a note's file is kept: under its class, named by the note. */
export function notePath(note: Pick<NoteSendChange, 'id' | 'classSectionId'>, type: NoteFileType) {
  return `${note.classSectionId}/${note.id}.${noteExtension[type]}`;
}

/** Uploads the note's file, if any, then the note. Both steps can be repeated safely. */
export async function sendClassNote(
  note: NoteSendChange,
  supabase: AppSupabaseClient,
  readFile: (id: string) => Promise<Blob>,
): Promise<void> {
  const path = note.file ? notePath(note, note.file.contentType) : null;
  if (note.file && path) {
    let file: Blob;
    try {
      file = await readFile(note.file.fileId);
    } catch (error) {
      // Gone from the phone for good; any other failure to read it is tried again later.
      if (error instanceof ChangeRejectedError) {
        throw new ChangeRejectedError(
          NOTE_FILE_MISSING,
          "The note's file is no longer on this phone.",
        );
      }
      throw error;
    }
    const { error: uploadError } = await supabase.storage
      .from(CLASS_NOTES_BUCKET)
      .upload(path, file, {
        contentType: note.file.contentType,
        upsert: false,
        cacheControl: '3600',
      });
    if (uploadError && !isAlreadyStored(uploadError)) {
      throw storageFailure(uploadError);
    }
  }
  // The school, the author and the time are recorded by the database; a note already received is
  // left as it is.
  const { error } = await supabase.from('class_notes').upsert(
    {
      id: note.id,
      class_section_id: note.classSectionId,
      school_id: note.schoolId,
      kind: note.kind,
      body: note.body.trim(),
      due_on: note.kind === 'homework' ? note.dueOn : null,
      attachment_path: path,
      attachment_type: note.file?.contentType ?? null,
      attachment_bytes: note.file?.bytes ?? null,
      attachment_name: note.file?.name ?? null,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) {
    // A note the server refuses for good leaves no file behind. Storage removes a file only while
    // no note carries it, so a note already received keeps its file.
    if (path && classifyFailure(error).kind === 'reject') {
      await supabase.storage.from(CLASS_NOTES_BUCKET).remove([path]);
    }
    throw error;
  }
}

/** Removes the file of a note that was never received, for example when it is discarded. */
export async function removeUnsentFile(
  note: Pick<NoteSendChange, 'id' | 'classSectionId' | 'file'>,
  supabase: AppSupabaseClient,
): Promise<void> {
  if (note.file) {
    await supabase.storage.from(CLASS_NOTES_BUCKET).remove([notePath(note, note.file.contentType)]);
  }
}

export const noteSendChange = registerChange<NoteSendChange>({
  kind: 'note.send',
  schema: noteSendSchema,
  // A file of a megabyte can take a while on a slow connection.
  timeoutMs: 120_000,
  files: (note) => (note.file ? [note.file.fileId] : []),
  send: async (note, context) => {
    await sendClassNote(note, context.supabase, context.readFile);
    return null;
  },
  invalidates: (note) => [classNotesKey(note.classSectionId)],
  describe: (note, t) =>
    t(note.kind === 'homework' ? 'notes.change.homework' : 'notes.change.message', {
      text: shortText(note.body),
    }),
});

const noteRemoveSchema = z.object({
  noteId: z.guid(),
  classSectionId: z.guid(),
  attachmentPath: z.string().max(200).nullable(),
  body: z.string().max(NOTE_BODY_LIMIT),
});

export type NoteRemoveChange = z.infer<typeof noteRemoveSchema>;

/** Removes a note, then its file, which storage keeps only while no note carries it. */
export async function removeClassNote(
  change: NoteRemoveChange,
  supabase: AppSupabaseClient,
): Promise<void> {
  const { data: removed, error } = await supabase
    .from('class_notes')
    .delete()
    .eq('id', change.noteId)
    .select('id');
  if (error) {
    throw error;
  }
  if (removed.length === 0) {
    // Nothing was removed: either it is gone already, or this account may no longer remove it.
    const { data: still, error: readError } = await supabase
      .from('class_notes')
      .select('id')
      .eq('id', change.noteId);
    if (readError) {
      throw readError;
    }
    if (still.length > 0) {
      throw new ChangeRejectedError(
        '42501',
        'This note can no longer be removed from this account.',
      );
    }
  }
  if (change.attachmentPath) {
    const { error: removeError } = await supabase.storage
      .from(CLASS_NOTES_BUCKET)
      .remove([change.attachmentPath]);
    if (removeError) {
      throw storageFailure(removeError);
    }
  }
}

export const noteRemoveChange = registerChange<NoteRemoveChange>({
  kind: 'note.remove',
  schema: noteRemoveSchema,
  send: async (change, context) => {
    await removeClassNote(change, context.supabase);
    return null;
  },
  invalidates: (change) => [classNotesKey(change.classSectionId)],
  describe: (change, t) => t('notes.change.remove', { text: shortText(change.body) }),
});

/** The start of a note, for the list of waiting changes. */
export function shortText(body: string): string {
  const text = body.trim().replace(/\s+/g, ' ');
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
