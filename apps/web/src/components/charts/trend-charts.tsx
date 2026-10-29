import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Small charts of change over months, drawn without a library. Each shows one measure on one
 * scale; hovering or focusing a month shows its figures in words above the chart, and every chart
 * can be read as a table. Colour never carries meaning alone: levels are named in the legend.
 *
 * Every point is keyed by its month, so two months with the same short name (October of two
 * years) never collide. A month without a figure stays in its place, shown as empty.
 */

interface Frame {
  title: ReactNode;
  /** Words for the table view's toggle and header. */
  tableLabel: string;
  monthHeader: string;
  /** What the chart shows before a month is chosen. */
  hint: ReactNode;
  children: (active: number | null, setActive: (index: number | null) => void) => ReactNode;
  table: ReactNode;
  readout: (index: number) => ReactNode;
}

function ChartFrame({ title, tableLabel, hint, children, table, readout }: Frame) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  return (
    <figure className="space-y-3" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="text-sm font-medium text-fg">
        {title}
      </figcaption>
      {/* For sighted readers only: each mark already carries the same words as its name. */}
      <p className="min-h-5 text-sm text-fg-muted" aria-hidden="true">
        {active === null ? hint : readout(active)}
      </p>
      {children(active, setActive)}
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">{tableLabel}</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

const MARK_FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function MonthLabels({
  points,
  gapless = false,
}: {
  points: readonly { key: string; label: string }[];
  /** Under a line, whose months sit in equal slots without gaps. */
  gapless?: boolean;
}) {
  return (
    <div className={cn('flex text-xs text-fg-muted', !gapless && 'gap-2')} aria-hidden="true">
      {points.map((point) => (
        <span key={point.key} className="min-w-6 flex-1 truncate text-center">
          {point.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Reading levels, month by month
// ---------------------------------------------------------------------------------------------

export interface LevelCounts {
  needsSupport: number;
  hesitant: number;
  fluent: number;
}

export interface LevelPoint {
  /** The month, `YYYY-MM-01`. */
  key: string;
  label: string;
  /** Null for a month without figures, or with figures held back. */
  counts: LevelCounts | null;
}

export interface LevelNames {
  needsSupport: string;
  hesitant: string;
  fluent: string;
  checked: string;
}

const LEVEL_PARTS = [
  { key: 'needsSupport', className: 'bg-danger' },
  { key: 'hesitant', className: 'bg-warning' },
  { key: 'fluent', className: 'bg-success' },
] as const;

/** The share of children at each reading level, one column a month. */
export function LevelTrend({
  points,
  names,
  title,
  tableLabel,
  monthHeader,
  hint,
  missing,
}: {
  points: readonly LevelPoint[];
  names: LevelNames;
  title: ReactNode;
  tableLabel: string;
  monthHeader: string;
  hint: ReactNode;
  /** Shown for a month without figures. */
  missing: string;
}) {
  const total = (counts: LevelCounts) => counts.needsSupport + counts.hesitant + counts.fluent;
  const words = ({ label, counts }: LevelPoint) =>
    counts === null
      ? `${label}: ${missing}`
      : `${label}: ${names.fluent} ${String(counts.fluent)}, ${names.hesitant} ${String(counts.hesitant)}, ${names.needsSupport} ${String(counts.needsSupport)} (${names.checked} ${String(total(counts))})`;
  return (
    <ChartFrame
      title={title}
      tableLabel={tableLabel}
      monthHeader={monthHeader}
      hint={hint}
      readout={(index) => (points[index] ? words(points[index]) : null)}
      table={
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="py-1 pe-3 font-medium">
                {monthHeader}
              </th>
              <th scope="col" className="py-1 pe-3 font-medium">
                {names.fluent}
              </th>
              <th scope="col" className="py-1 pe-3 font-medium">
                {names.hesitant}
              </th>
              <th scope="col" className="py-1 pe-3 font-medium">
                {names.needsSupport}
              </th>
              <th scope="col" className="py-1 font-medium">
                {names.checked}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map(({ key, label, counts }) => (
              <tr key={key} className="border-t border-border">
                <th scope="row" className="py-1 pe-3 font-normal">
                  {label}
                </th>
                {counts === null ? (
                  <td className="py-1 text-fg-muted" colSpan={4}>
                    {missing}
                  </td>
                ) : (
                  <>
                    <td className="py-1 pe-3">{counts.fluent}</td>
                    <td className="py-1 pe-3">{counts.hesitant}</td>
                    <td className="py-1 pe-3">{counts.needsSupport}</td>
                    <td className="py-1">{total(counts)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {(active, setActive) => (
        <div className="space-y-2">
          <div className="flex h-36 items-end gap-2" onMouseLeave={() => setActive(null)}>
            {points.map((point, index) => {
              const counts = point.counts;
              const sum = counts === null ? 0 : total(counts);
              return (
                <div
                  key={point.key}
                  role="img"
                  tabIndex={0}
                  aria-label={words(point)}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    'flex h-full min-w-6 flex-1 flex-col-reverse gap-0.5 rounded-t-sm',
                    MARK_FOCUS,
                    active !== null && active !== index && 'opacity-60',
                  )}
                >
                  {counts === null || sum === 0 ? (
                    <div className="h-1 rounded-sm bg-surface-sunken" />
                  ) : (
                    LEVEL_PARTS.map((part) =>
                      counts[part.key] > 0 ? (
                        <div
                          key={part.key}
                          className={cn(part.className, 'last:rounded-t-sm')}
                          style={{ height: `${String((counts[part.key] / sum) * 100)}%` }}
                        />
                      ) : null,
                    )
                  )}
                </div>
              );
            })}
          </div>
          <MonthLabels points={points} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
            {[...LEVEL_PARTS].reverse().map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-full', part.className)} aria-hidden="true" />
                {names[part.key]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// One measure, month by month
// ---------------------------------------------------------------------------------------------

export interface ValuePoint {
  /** The month (`YYYY-MM-01`), or another key unique within the chart. */
  key: string;
  label: string;
  value: number | null;
}

/** The runs of consecutive points with a value: a line never bridges a month without one. */
function runsOf(points: readonly ValuePoint[]): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) {
        runs.push(current);
      }
      current = [];
    } else {
      current.push({ index, value: point.value });
    }
  });
  if (current.length > 0) {
    runs.push(current);
  }
  return runs;
}

/**
 * One measure as a line (`kind: 'line'`) or as columns (`kind: 'columns'`), on a scale from zero,
 * with an optional reference line such as a target.
 */
export function ValueTrend({
  points,
  kind,
  title,
  valueHeader,
  format,
  maximum,
  reference,
  tableLabel,
  monthHeader,
  hint,
  missing,
}: {
  points: readonly ValuePoint[];
  kind: 'line' | 'columns';
  title: ReactNode;
  valueHeader: string;
  format: (value: number) => string;
  /** The top of the scale; by default a little above the highest value or the reference. */
  maximum?: number;
  reference?: { value: number; label: string } | undefined;
  tableLabel: string;
  monthHeader: string;
  hint: ReactNode;
  /** Shown for a month without a value. */
  missing: string;
}) {
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const top = maximum ?? Math.max(1, ...values, reference?.value ?? 0) * 1.15;
  const width = 300;
  const height = 120;
  // Each month sits in the middle of an equal slot, so the labels below line up with the points.
  const slot = width / Math.max(1, points.length);
  const x = (index: number) => slot * index + slot / 2;
  const y = (value: number) => height - (Math.min(value, top) / top) * height;
  const words = (point: ValuePoint) =>
    `${point.label}: ${point.value === null ? missing : format(point.value)}`;

  return (
    <ChartFrame
      title={title}
      tableLabel={tableLabel}
      monthHeader={monthHeader}
      hint={hint}
      readout={(index) => (points[index] ? words(points[index]) : null)}
      table={
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="py-1 pe-3 font-medium">
                {monthHeader}
              </th>
              <th scope="col" className="py-1 font-medium">
                {valueHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key} className="border-t border-border">
                <th scope="row" className="py-1 pe-3 font-normal">
                  {point.label}
                </th>
                <td className={cn('py-1', point.value === null && 'text-fg-muted')}>
                  {point.value === null ? missing : format(point.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {(active, setActive) =>
        kind === 'columns' ? (
          <div className="space-y-2">
            <div className="flex h-36 items-end gap-2" onMouseLeave={() => setActive(null)}>
              {points.map((point, index) => (
                <div
                  key={point.key}
                  role="img"
                  tabIndex={0}
                  aria-label={words(point)}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    'relative flex h-full min-w-6 flex-1 items-end',
                    MARK_FOCUS,
                    active !== null && active !== index && 'opacity-60',
                  )}
                >
                  <div
                    className={cn(
                      'w-full rounded-t-sm',
                      point.value === null ? 'h-1 bg-surface-sunken' : 'bg-primary',
                    )}
                    style={
                      point.value === null
                        ? undefined
                        : {
                            height: `${String(Math.max(2, (Math.min(point.value, top) / top) * 100))}%`,
                          }
                    }
                  />
                </div>
              ))}
            </div>
            <MonthLabels points={points} />
          </div>
        ) : (
          <div className="space-y-2">
            <svg
              viewBox={`0 -8 ${String(width)} ${String(height + 16)}`}
              className="h-auto w-full overflow-visible"
              onMouseLeave={() => setActive(null)}
            >
              <line
                x1={0}
                x2={width}
                y1={height}
                y2={height}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {reference ? (
                <line
                  x1={0}
                  x2={width}
                  y1={y(reference.value)}
                  y2={y(reference.value)}
                  className="stroke-fg-muted"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {runsOf(points).map((run) =>
                run.length > 1 ? (
                  <polyline
                    key={points[run[0]?.index ?? 0]?.key}
                    points={run
                      .map((entry) => `${String(x(entry.index))},${String(y(entry.value))}`)
                      .join(' ')}
                    fill="none"
                    className="stroke-primary"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
              {points.map((point, index) => (
                <g
                  key={point.key}
                  role="img"
                  tabIndex={0}
                  aria-label={words(point)}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="group outline-none"
                >
                  {/* A target as wide as the month's slot, so a finger finds it. */}
                  <rect
                    x={x(index) - slot / 2}
                    y={-8}
                    width={slot}
                    height={height + 16}
                    fill="transparent"
                  />
                  <circle
                    cx={x(index)}
                    cy={point.value === null ? height - 1.5 : y(point.value)}
                    r={9}
                    fill="none"
                    className="stroke-ring opacity-0 group-focus-visible:opacity-100"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  {point.value === null ? (
                    <rect
                      x={x(index) - 6}
                      y={height - 3}
                      width={12}
                      height={3}
                      rx={1.5}
                      className="fill-surface-sunken"
                    />
                  ) : (
                    <circle
                      cx={x(index)}
                      cy={y(point.value)}
                      r={active === index ? 6 : 4}
                      className="fill-primary stroke-surface"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              ))}
            </svg>
            <MonthLabels points={points} gapless />
            {reference ? (
              <p className="inline-flex items-center gap-2 text-xs text-fg-muted">
                <span className="w-6 border-t border-dashed border-fg-muted" aria-hidden="true" />
                {reference.label}
              </p>
            ) : null}
          </div>
        )
      }
    </ChartFrame>
  );
}
