import { describe, expect, it, vi } from 'vitest';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import type { AppSupabaseClient } from '@/lib/supabase';
import {
  NOTE_FILE_MISSING,
  removeClassNote,
  sendClassNote,
  type NoteSendChange,
} from './note-change';

const note: NoteSendChange = {
  id: '0f1e2d3c-4b5a-4968-8776-655443322110',
  classSectionId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  schoolId: '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9',
  kind: 'homework',
  body: 'Read page 12.',
  dueOn: '2026-10-22',
  file: { fileId: 'file-1', contentType: 'application/pdf', name: 'Page 12.pdf', bytes: 8 },
  writtenAt: '2026-10-21T05:00:00.000Z',
};
const path = `${note.classSectionId}/${note.id}.pdf`;

/** A stand-in for the client, answering the calls a note makes. */
function fakeClient(answers: {
  upsert?: { error: unknown };
  deleted?: { id: string }[];
  still?: { id: string }[];
}) {
  const upload = vi.fn(() => Promise.resolve({ error: null }));
  const remove = vi.fn(() => Promise.resolve({ data: [], error: null }));
  const client = {
    storage: { from: () => ({ upload, remove }) },
    from: () => ({
      upsert: () => Promise.resolve(answers.upsert ?? { error: null }),
      delete: () => ({
        eq: () => ({ select: () => Promise.resolve({ data: answers.deleted ?? [], error: null }) }),
      }),
      select: () => ({ eq: () => Promise.resolve({ data: answers.still ?? [], error: null }) }),
    }),
  };
  return { client: client as unknown as AppSupabaseClient, upload, remove };
}

const file = () => Promise.resolve(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));

describe('sending a note', () => {
  it('removes the uploaded file when the server refuses the note for good', async () => {
    const refusal = { code: '23514', message: 'Homework is due within the next 60 days.' };
    const { client, upload, remove } = fakeClient({ upsert: { error: refusal } });
    await expect(sendClassNote(note, client, file)).rejects.toEqual(refusal);
    expect(upload).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it('keeps the file when the note will be tried again', async () => {
    const { client, remove } = fakeClient({ upsert: { error: { code: '', message: 'offline' } } });
    await expect(sendClassNote(note, client, file)).rejects.toBeDefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses for good only a file that is gone from the phone', async () => {
    const { client } = fakeClient({});
    const gone = () => Promise.reject(new ChangeRejectedError('file_missing', 'Gone.'));
    await expect(sendClassNote(note, client, gone)).rejects.toMatchObject({
      code: NOTE_FILE_MISSING,
    });
    const busy = new Error('The device store is busy.');
    await expect(sendClassNote(note, client, () => Promise.reject(busy))).rejects.toBe(busy);
  });
});

describe('removing a note', () => {
  const change = {
    noteId: note.id,
    classSectionId: note.classSectionId,
    attachmentPath: path,
    body: note.body,
  };

  it('removes the note, then its file', async () => {
    const { client, remove } = fakeClient({ deleted: [{ id: note.id }] });
    await removeClassNote(change, client);
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it('is refused when the note is still there but this account cannot remove it', async () => {
    const { client, remove } = fakeClient({ deleted: [], still: [{ id: note.id }] });
    await expect(removeClassNote(change, client)).rejects.toBeInstanceOf(ChangeRejectedError);
    expect(remove).not.toHaveBeenCalled();
  });

  it('counts a note already gone as removed', async () => {
    const { client } = fakeClient({ deleted: [], still: [] });
    await expect(removeClassNote(change, client)).resolves.toBeUndefined();
  });
});
