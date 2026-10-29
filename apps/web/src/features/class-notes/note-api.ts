import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { keepOrSend } from '@/features/offline/keep-or-send';
import { offlineRuntime } from '@/features/offline/offline-runtime';
import { getSupabase } from '@/lib/supabase';
import {
  classNotesKey,
  NOTE_FILE_TYPES,
  noteDedupeKey,
  noteRemoveChange,
  noteRemoveDedupeKey,
  noteSendChange,
  removeClassNote,
  sendClassNote,
  type NoteFileType,
  type NoteKind,
  type NoteSendChange,
} from './note-change';
import type { PreparedFile } from './note-file';

export interface NoteAttachment {
  path: string;
  type: NoteFileType;
  bytes: number;
  name: string | null;
}

/** A note as the server holds it. */
export interface ClassNote {
  id: string;
  classSectionId: string;
  kind: NoteKind;
  body: string;
  dueOn: string | null;
  attachment: NoteAttachment | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

/** The notes a class shows, the latest first. */
export const NOTES_SHOWN = 100;

function fileTypeOf(value: string | null): NoteFileType | null {
  return NOTE_FILE_TYPES.find((type) => type === value) ?? null;
}

/** A class's latest notes, for its teachers and for the families of its children. */
export function classNotesQuery(classSectionId: string) {
  return queryOptions({
    queryKey: classNotesKey(classSectionId),
    meta: { persist: true },
    staleTime: 60_000,
    queryFn: async (): Promise<ClassNote[]> => {
      const { data, error } = await getSupabase()
        .from('class_notes')
        .select(
          'id, class_section_id, kind, body, due_on, attachment_path, attachment_type, attachment_bytes, attachment_name, author_id, author_name, created_at',
        )
        .eq('class_section_id', classSectionId)
        .order('created_at', { ascending: false })
        .limit(NOTES_SHOWN);
      if (error) {
        throw error;
      }
      return data.map((row) => {
        const type = fileTypeOf(row.attachment_type);
        return {
          id: row.id,
          classSectionId: row.class_section_id,
          kind: row.kind === 'homework' ? 'homework' : 'message',
          body: row.body,
          dueOn: row.due_on,
          attachment:
            row.attachment_path && type && row.attachment_bytes
              ? {
                  path: row.attachment_path,
                  type,
                  bytes: row.attachment_bytes,
                  name: row.attachment_name,
                }
              : null,
          authorId: row.author_id,
          authorName: row.author_name,
          createdAt: row.created_at,
        };
      });
    },
  });
}

/** What the teacher writes; the note's identity and time are added when it is sent. */
export interface NoteDraft {
  /** Kept for the draft until it is sent, so that trying again never sends it twice. */
  id: string;
  classSectionId: string;
  schoolId: string;
  kind: NoteKind;
  body: string;
  dueOn: string | null;
  file: PreparedFile | null;
}

/**
 * Sends a note: kept on the phone with its file and sent when it can be, or sent at once where the
 * phone cannot keep it. Resolves to `kept` (waiting on the phone), `sent`, or `failed`.
 */
export function useSendNote() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useCallback(
    async (draft: NoteDraft): Promise<'kept' | 'sent' | 'failed'> => {
      const note: NoteSendChange = {
        id: draft.id,
        classSectionId: draft.classSectionId,
        schoolId: draft.schoolId,
        kind: draft.kind,
        body: draft.body.trim(),
        dueOn: draft.kind === 'homework' ? draft.dueOn : null,
        file: null,
        writtenAt: new Date().toISOString(),
      };
      const fileOf = (fileId: string) =>
        draft.file
          ? {
              fileId,
              contentType: draft.file.contentType,
              name: draft.file.name,
              bytes: draft.file.blob.size,
            }
          : null;
      if (offlineRuntime.isAvailable) {
        let fileId: string | null = null;
        try {
          fileId = draft.file ? await offlineRuntime.storeFile(draft.file.blob) : null;
          await offlineRuntime.enqueue(
            noteSendChange.kind,
            { ...note, file: fileId ? fileOf(fileId) : null },
            noteDedupeKey(note.id),
          );
          return 'kept';
        } catch {
          // The phone cannot keep it: it is sent now instead.
          if (fileId) {
            await offlineRuntime.deleteFiles([fileId]).catch(() => undefined);
          }
        }
      }
      try {
        const blob = draft.file?.blob;
        await sendClassNote({ ...note, file: fileOf('memory') }, getSupabase(), () =>
          blob ? Promise.resolve(blob) : Promise.reject(new Error('No file.')),
        );
        void queryClient.invalidateQueries({ queryKey: classNotesKey(note.classSectionId) });
        return 'sent';
      } catch {
        toast.error(t('notes.sendFailed'));
        return 'failed';
      }
    },
    [queryClient, t],
  );
}

/** Removes a sent note at once from the screen, and from the server when it can be. */
export function useRemoveNote() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useCallback(
    async (note: ClassNote): Promise<boolean> => {
      const change = {
        noteId: note.id,
        classSectionId: note.classSectionId,
        attachmentPath: note.attachment?.path ?? null,
        body: note.body,
      };
      const key = classNotesKey(note.classSectionId);
      const before = queryClient.getQueryData<ClassNote[]>(key);
      queryClient.setQueryData<ClassNote[]>(key, (notes) =>
        notes?.filter((entry) => entry.id !== note.id),
      );
      try {
        await keepOrSend(noteRemoveChange.kind, change, noteRemoveDedupeKey(note.id), async () => {
          await removeClassNote(change, getSupabase());
          void queryClient.invalidateQueries({ queryKey: key });
        });
        return true;
      } catch {
        queryClient.setQueryData(key, before);
        toast.error(t('notes.removeFailed'));
        return false;
      }
    },
    [queryClient, t],
  );
}
