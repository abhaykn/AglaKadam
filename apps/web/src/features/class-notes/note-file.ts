import { NOTE_FILE_LIMIT, NOTE_FILE_TYPES, type NoteFileType } from './note-change';

/**
 * A picture or PDF a teacher attaches to a note, made ready on the phone: pictures are made smaller
 * (a photo of a page stays readable at 1600 pixels) and sent as JPEG, so that they fit in the
 * megabyte storage takes and cost families little data. A PDF is sent as it is.
 */

export interface PreparedFile {
  blob: Blob;
  contentType: NoteFileType;
  name: string | null;
}

export type FileProblem = 'type' | 'tooLarge' | 'unreadable';

/** The longest side of a picture sent with a note. */
export const PICTURE_SIDE = 1600;
const QUALITIES = [0.82, 0.72, 0.62, 0.5];

/** The size of a picture whose longer side is at most `limit`, keeping its proportions. */
export function fitWithin(
  width: number,
  height: number,
  limit: number,
): { width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function isNoteFileType(type: string): type is NoteFileType {
  return (NOTE_FILE_TYPES as readonly string[]).includes(type);
}

/** A file name families can read, at most 120 characters, with the extension of its type. */
export function noteFileName(name: string, extension: string): string | null {
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .trim()
    .slice(0, 110);
  return base ? `${base}.${extension}` : null;
}

async function shrinkPicture(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, PICTURE_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    // Transparent areas of a PNG would turn black in a JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      });
      if (blob && blob.size <= NOTE_FILE_LIMIT) {
        return blob;
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}

export async function prepareNoteFile(
  file: File,
): Promise<{ file: PreparedFile } | { problem: FileProblem }> {
  if (file.type === 'application/pdf') {
    return file.size > 0 && file.size <= NOTE_FILE_LIMIT
      ? {
          file: {
            blob: file,
            contentType: 'application/pdf',
            name: noteFileName(file.name, 'pdf'),
          },
        }
      : { problem: file.size > 0 ? 'tooLarge' : 'unreadable' };
  }
  if (!file.type.startsWith('image/')) {
    return { problem: 'type' };
  }
  const smaller = await shrinkPicture(file);
  if (smaller) {
    return {
      file: { blob: smaller, contentType: 'image/jpeg', name: noteFileName(file.name, 'jpg') },
    };
  }
  // The phone could not redraw the picture; one that already fits is sent as it is.
  if (isNoteFileType(file.type) && file.size > 0 && file.size <= NOTE_FILE_LIMIT) {
    const extension =
      file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    return {
      file: { blob: file, contentType: file.type, name: noteFileName(file.name, extension) },
    };
  }
  return { problem: file.size > NOTE_FILE_LIMIT ? 'tooLarge' : 'unreadable' };
}
