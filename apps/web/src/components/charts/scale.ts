/** The top of a scale that holds `raw`, on a round number, so the axis reads 0, half, whole. */
export function niceMaximum(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 1;
  }
  const base = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / base;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * base;
}
