/** The April-to-March session that starts in the given year, as used by schools in India. */
export function sessionStartingIn(year: number): {
  label: string;
  startsOn: string;
  endsOn: string;
} {
  return {
    label: `${String(year)}-${String((year + 1) % 100).padStart(2, '0')}`,
    startsOn: `${String(year)}-04-01`,
    endsOn: `${String(year + 1)}-03-31`,
  };
}
