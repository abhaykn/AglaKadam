import { Table2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { niceMaximum } from './scale';

/**
 * Small charts of change over months, drawn without a library. Each shows one measure on one
 * scale, with gridlines and a labelled axis; hovering or focusing a month shows its figures in
 * words above the chart, and every chart can be read as a table. Colour never carries meaning
 * alone: levels are named in the legend and their shares are written on the columns.
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
      <figcaption id={`${id}-title`} className="text-sm font-semibold text-fg">
        {title}
      </figcaption>
      {/* For sighted readers only: each mark already carries the same words as its name. */}
      <p className="min-h-7 text-xs text-fg-subtle" aria-hidden="true">
        {active === null ? (
          hint
        ) : (
          <span className="inline-flex max-w-full items-center rounded-full bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary-soft-fg">
            {readout(active)}
          </span>
        )}
      </p>
      <div className="rounded-xl border border-border bg-surface-muted p-4 pt-6">
        {children(active, setActive)}
      </div>
      <details className="text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-xs font-medium text-primary hover:underline">
          <Table2 className="size-3.5" aria-hidden="true" />
          {tableLabel}
        </summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

const MARK_FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The width of the axis labels, shared by the plot and the month labels under it. */
const AXIS_WIDTH = 'w-9';

const plain = (value: number) => String(Math.round(value * 10) / 10);

const GRID = [0, 0.5, 1] as const;

/** The plot's frame: axis labels at the left, gridlines behind, the marks in front. */
function Plot({
  axis,
  top,
  children,
}: {
  axis: (value: number) => string;
  top: number;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className={cn('relative h-44 shrink-0', AXIS_WIDTH)} aria-hidden="true">
        {GRID.map((fraction) => (
          <span
            key={fraction}
            className="absolute right-0 translate-y-1/2 text-xs leading-none text-fg-subtle tabular-nums"
            style={{ bottom: `${String(fraction * 100)}%` }}
          >
            {axis(top * fraction)}
          </span>
        ))}
      </div>
      <div className="relative h-44 min-w-0 flex-1">
        {GRID.map((fraction) => (
          <div
            key={fraction}
            aria-hidden="true"
            className={cn(
              'absolute inset-x-0 border-t',
              fraction === 0 ? 'border-border-strong' : 'border-dashed border-border',
            )}
            style={{ bottom: `${String(fraction * 100)}%` }}
          />
        ))}
        {children}
      </div>
    </div>
  );
}

function MonthLabels({
  points,
  active,
}: {
  points: readonly { key: string; label: string }[];
  active: number | null;
}) {
  return (
    <div className="mt-2 flex gap-2 text-xs" aria-hidden="true">
      <span className={cn('shrink-0', AXIS_WIDTH)} />
      <div className="flex min-w-0 flex-1">
        {points.map((point, index) => (
          <span
            key={point.key}
            className={cn(
              'min-w-0 flex-1 truncate text-center transition-colors',
              active === index ? 'font-semibold text-fg' : 'text-fg-muted',
            )}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A month's slot in the plot: the hover and focus target, a finger wide. */
function Slot({
  index,
  active,
  setActive,
  label,
  children,
}: {
  index: number;
  active: number | null;
  setActive: (index: number | null) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="img"
      tabIndex={0}
      aria-label={label}
      onMouseEnter={() => setActive(index)}
      onFocus={() => setActive(index)}
      onBlur={() => setActive(null)}
      className={cn(
        'group relative h-full min-w-0 flex-1 rounded-md transition-opacity',
        MARK_FOCUS,
        active !== null && active !== index && 'opacity-55',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0.5 inset-y-0 rounded-lg bg-white/[0.045] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
      {children}
    </div>
  );
}

/** The marks of every month, side by side over the whole plot. */
function Slots({
  setActive,
  children,
}: {
  setActive: (index: number | null) => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex" onMouseLeave={() => setActive(null)}>
      {children}
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

/** From the top of a column down: those who read well, then those who hesitate, then the rest. */
const LEVEL_PARTS = [
  { key: 'fluent', className: 'bg-success' },
  { key: 'hesitant', className: 'bg-warning' },
  { key: 'needsSupport', className: 'bg-danger' },
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
              <th scope="col" className="py-1.5 pe-3 font-medium">
                {monthHeader}
              </th>
              <th scope="col" className="py-1.5 pe-3 font-medium">
                {names.fluent}
              </th>
              <th scope="col" className="py-1.5 pe-3 font-medium">
                {names.hesitant}
              </th>
              <th scope="col" className="py-1.5 pe-3 font-medium">
                {names.needsSupport}
              </th>
              <th scope="col" className="py-1.5 font-medium">
                {names.checked}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map(({ key, label, counts }) => (
              <tr key={key} className="border-t border-border">
                <th scope="row" className="py-1.5 pe-3 font-normal">
                  {label}
                </th>
                {counts === null ? (
                  <td className="py-1.5 text-fg-muted" colSpan={4}>
                    {missing}
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 pe-3">{counts.fluent}</td>
                    <td className="py-1.5 pe-3">{counts.hesitant}</td>
                    <td className="py-1.5 pe-3">{counts.needsSupport}</td>
                    <td className="py-1.5">{total(counts)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {(active, setActive) => (
        <div>
          <Plot axis={(value) => `${String(Math.round(value))}%`} top={100}>
            <Slots setActive={setActive}>
              {points.map((point, index) => {
                const counts = point.counts;
                const sum = counts === null ? 0 : total(counts);
                return (
                  <Slot
                    key={point.key}
                    index={index}
                    active={active}
                    setActive={setActive}
                    label={words(point)}
                  >
                    <div className="absolute inset-x-0 inset-y-0 flex items-end justify-center">
                      {counts === null || sum === 0 ? (
                        <span
                          aria-hidden="true"
                          className="mb-1 h-0.5 w-4 rounded-full bg-fg-subtle/40"
                        />
                      ) : (
                        <div className="flex h-full w-[60%] max-w-16 flex-col gap-0.5 overflow-hidden rounded-t-lg">
                          {LEVEL_PARTS.map((part) => {
                            const share = (counts[part.key] / sum) * 100;
                            return counts[part.key] > 0 ? (
                              <div
                                key={part.key}
                                className={cn(
                                  part.className,
                                  'flex items-center justify-center text-xs font-semibold text-neutral-950/80 tabular-nums',
                                )}
                                style={{ height: `${String(share)}%` }}
                              >
                                {share >= 12 ? `${String(Math.round(share))}%` : null}
                              </div>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  </Slot>
                );
              })}
            </Slots>
          </Plot>
          <MonthLabels points={points} active={active} />
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 ps-11 text-xs text-fg-muted">
            {LEVEL_PARTS.map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-sm', part.className)} aria-hidden="true" />
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
  axis = plain,
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
  /** A short form of a value for the axis and the marks, without a unit that needs words. */
  axis?: (value: number) => string;
  /** The top of the scale; by default a round number above the highest value or the reference. */
  maximum?: number;
  reference?: { value: number; label: string } | undefined;
  tableLabel: string;
  monthHeader: string;
  hint: ReactNode;
  /** Shown for a month without a value. */
  missing: string;
}) {
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const top = maximum ?? niceMaximum(Math.max(1, ...values, reference?.value ?? 0));
  const gradient = useId();
  const width = 300;
  const height = 100;
  // Each month sits in the middle of an equal slot, so the labels below line up with the marks.
  const slot = width / Math.max(1, points.length);
  const x = (index: number) => slot * index + slot / 2;
  const share = (value: number) => Math.min(value, top) / top;
  const y = (value: number) => height - share(value) * height;
  const words = (point: ValuePoint) =>
    `${point.label}: ${point.value === null ? missing : format(point.value)}`;
  const last = points.reduce((found, point, index) => (point.value === null ? found : index), -1);

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
              <th scope="col" className="py-1.5 pe-3 font-medium">
                {monthHeader}
              </th>
              <th scope="col" className="py-1.5 font-medium">
                {valueHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key} className="border-t border-border">
                <th scope="row" className="py-1.5 pe-3 font-normal">
                  {point.label}
                </th>
                <td className={cn('py-1.5', point.value === null && 'text-fg-muted')}>
                  {point.value === null ? missing : format(point.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {(active, setActive) => (
        <div>
          <Plot axis={axis} top={top}>
            {kind === 'line' ? (
              <svg
                viewBox={`0 0 ${String(width)} ${String(height)}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" className="[stop-color:var(--primary)]" stopOpacity="0.32" />
                    <stop offset="1" className="[stop-color:var(--primary)]" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {reference ? (
                  <line
                    x1={0}
                    x2={width}
                    y1={y(reference.value)}
                    y2={y(reference.value)}
                    className="stroke-accent"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {runsOf(points).map((run) => {
                  const coordinates = run
                    .map((entry) => `${String(x(entry.index))},${String(y(entry.value))}`)
                    .join(' ');
                  const first = run[0];
                  const end = run.at(-1);
                  return (
                    <g key={points[first?.index ?? 0]?.key}>
                      {first && end && run.length > 1 ? (
                        <polygon
                          points={`${String(x(first.index))},${String(height)} ${coordinates} ${String(x(end.index))},${String(height)}`}
                          fill={`url(#${gradient})`}
                        />
                      ) : null}
                      {run.length > 1 ? (
                        <polyline
                          points={coordinates}
                          fill="none"
                          className="stroke-primary"
                          strokeWidth={2.5}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            ) : null}
            <Slots setActive={setActive}>
              {points.map((point, index) => {
                const value = point.value;
                const emphasised = active === index || (active === null && index === last);
                const labelled = points.length <= 8 || emphasised;
                return (
                  <Slot
                    key={point.key}
                    index={index}
                    active={active}
                    setActive={setActive}
                    label={words(point)}
                  >
                    {value === null ? (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-fg-subtle/40"
                      />
                    ) : kind === 'columns' ? (
                      <div
                        className="absolute bottom-0 left-1/2 w-[58%] max-w-14 -translate-x-1/2"
                        style={{ height: `${String(Math.max(2, share(value) * 100))}%` }}
                      >
                        <div
                          className={cn(
                            'h-full w-full rounded-t-lg bg-gradient-to-t transition-[filter]',
                            emphasised
                              ? 'from-primary/75 to-primary'
                              : 'from-primary/45 to-primary/80',
                          )}
                        />
                        {labelled ? (
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-semibold text-fg tabular-nums">
                            {axis(value)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span
                        className="absolute left-1/2 -translate-x-1/2 translate-y-1/2"
                        style={{ bottom: `${String(share(value) * 100)}%` }}
                      >
                        <span
                          className={cn(
                            'block rounded-full bg-primary ring-2 ring-[color:var(--surface-solid)] transition-all',
                            emphasised
                              ? 'size-4 shadow-[0_0_0_5px_rgb(124_200_242/0.22)]'
                              : 'size-3',
                          )}
                        />
                        {labelled ? (
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-semibold text-fg tabular-nums">
                            {axis(value)}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </Slot>
                );
              })}
            </Slots>
          </Plot>
          <MonthLabels points={points} active={active} />
          {reference ? (
            <p className="mt-4 inline-flex items-center gap-2 ps-11 text-xs text-fg-muted">
              <span className="w-6 border-t-2 border-dashed border-accent" aria-hidden="true" />
              {reference.label}
            </p>
          ) : null}
        </div>
      )}
    </ChartFrame>
  );
}
