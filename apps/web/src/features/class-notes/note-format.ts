/** The time of a note for people to read, in India: "21 Oct, 4:05 pm". */
export function formatNoteTime(at: string, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(at));
}

/** A file size for people to read: "340 KB". */
export function formatBytes(bytes: number, language: string): string {
  const format = new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    maximumFractionDigits: bytes >= 1_000_000 ? 1 : 0,
  });
  return bytes >= 1_000_000
    ? `${format.format(bytes / 1_000_000)} MB`
    : `${format.format(Math.max(1, Math.round(bytes / 1000)))} KB`;
}
