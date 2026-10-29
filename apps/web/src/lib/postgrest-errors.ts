/**
 * Whether a Data API error says that the requested page starts beyond the end of the list, which
 * happens when a list shrinks while someone is looking at one of its later pages.
 */
export function isPageOutOfRange(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'PGRST103'
  );
}
