import { describe, expect, it } from 'vitest';
import { notePath, shortText } from './note-change';
import { fitWithin, noteFileName, prepareNoteFile } from './note-file';

describe('files of notes', () => {
  it('fits pictures within the longest side, keeping their shape', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1080, 2400, 1600)).toEqual({ width: 720, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('names files families can read, with the extension of their type', () => {
    expect(noteFileName('Homework page 2.HEIC', 'jpg')).toBe('Homework page 2.jpg');
    expect(noteFileName('a/b:c*.pdf', 'pdf')).toBe('a b c.pdf');
    expect(noteFileName('.pdf', 'pdf')).toBeNull();
  });

  it('sends a PDF as it is, and refuses one too large or of another type', async () => {
    const pdf = new File(['%PDF-1.7'], 'Worksheet.pdf', { type: 'application/pdf' });
    expect(await prepareNoteFile(pdf)).toEqual({
      file: { blob: pdf, contentType: 'application/pdf', name: 'Worksheet.pdf' },
    });
    const large = new File([new Uint8Array(1_048_577)], 'Big.pdf', { type: 'application/pdf' });
    expect(await prepareNoteFile(large)).toEqual({ problem: 'tooLarge' });
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    expect(await prepareNoteFile(text)).toEqual({ problem: 'type' });
  });

  it('keeps a file under its class and its note', () => {
    const note = {
      id: '0f1e2d3c-4b5a-4968-8776-655443322110',
      classSectionId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    };
    expect(notePath(note, 'image/jpeg')).toBe(`${note.classSectionId}/${note.id}.jpg`);
    expect(notePath(note, 'application/pdf')).toBe(`${note.classSectionId}/${note.id}.pdf`);
  });

  it('shortens long notes for the list of waiting changes', () => {
    expect(shortText('  Bring   a leaf  ')).toBe('Bring a leaf');
    expect(shortText('x'.repeat(60))).toHaveLength(40);
  });
});
