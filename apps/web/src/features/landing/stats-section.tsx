import { Check, Languages, School, ShieldCheck, Target, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CountUp } from './count-up';
import { NightReadingScene } from './illustrations';
import { Reveal } from './reveal';

const stats = ['children', 'names', 'check', 'followUp'] as const;
type Stat = (typeof stats)[number];

const tags: readonly {
  key: 'nipun' | 'samagra' | 'dpdp' | 'offline' | 'bilingual';
  icon: LucideIcon;
}[] = [
  { key: 'nipun', icon: Target },
  { key: 'samagra', icon: School },
  { key: 'dpdp', icon: ShieldCheck },
  { key: 'offline', icon: WifiOff },
  { key: 'bilingual', icon: Languages },
];

const DOTS = Array.from({ length: 20 }, (_, index) => index);
/** Which five of the twenty children are named this week; spread out to read as a sample. */
const NAMED = new Set([2, 7, 9, 14, 18]);
const RING_LENGTH = 2 * Math.PI * 26;

/** A small drawing for each number, which animates once its card scrolls into view. */
function StatVisual({ kind }: { kind: Stat }) {
  if (kind === 'children' || kind === 'names') {
    return (
      <div aria-hidden="true" className="grid w-fit grid-cols-10 gap-1 sm:gap-2">
        {DOTS.map((dot) => {
          const hot = kind === 'names' && NAMED.has(dot);
          return (
            <span
              key={dot}
              data-hot={hot || undefined}
              className="stat-dot size-2 rounded-full bg-primary sm:size-3"
              style={{ '--d': `${dot * 45}ms` } as React.CSSProperties}
            />
          );
        })}
      </div>
    );
  }
  if (kind === 'check') {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 64" className="size-12 sm:size-14">
        <circle cx="32" cy="32" r="26" className="fill-none stroke-white/15" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r="26"
          className="stat-ring fill-none stroke-primary"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          style={{ '--len': RING_LENGTH } as React.CSSProperties}
          transform="rotate(-90 32 32)"
        />
        <path
          d="M32 20v13l8 5"
          className="fill-none stroke-white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <div aria-hidden="true" className="flex w-full items-center gap-2">
      {[0, 1, 2].map((week) => (
        <span key={week} className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
          <span
            className="stat-bar block h-full w-full rounded-full bg-primary"
            style={{ '--d': `${week * 450 + 300}ms` } as React.CSSProperties}
          />
        </span>
      ))}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-300 text-black">
        <Check className="size-4" />
      </span>
    </div>
  );
}

/** The numbers behind the loop, presented under a night reading scene. */
export function StatsSection() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="stats-title"
      className="snap-page relative flex flex-col justify-center px-4 py-14 sm:px-8 sm:py-20 lg:min-h-dvh"
    >
      <div className="mx-auto w-full max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="space-y-4">
            <p className="text-sm font-medium tracking-wide text-primary">
              {t('landing.stats.eyebrow')}
            </p>
            <h2
              id="stats-title"
              className="max-w-3xl text-[2.5rem] leading-[0.98] font-normal tracking-[-0.03em] text-balance text-fg sm:text-6xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {t('landing.stats.label')}
            </h2>
          </div>
          <ul className="flex flex-wrap gap-2 lg:max-w-xl lg:justify-end">
            {tags.map(({ key, icon: Icon }) => (
              <li
                key={key}
                className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm text-fg"
              >
                <Icon className="size-4 text-primary" aria-hidden="true" />
                {t(`landing.stats.tags.${key}`)}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120} className="mt-8 sm:mt-12">
          <div className="liquid-glass overflow-hidden rounded-3xl">
            <div className="relative h-40 sm:h-60 lg:h-72">
              <NightReadingScene className="absolute inset-0 h-full w-full" />
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[hsl(201_100%_11%/0.9)] to-transparent"
              />
            </div>
            <ul className="grid grid-cols-2 lg:grid-cols-4">
              {stats.map((key, index) => (
                <li
                  key={key}
                  className={
                    'flex flex-col gap-4 p-5 sm:gap-6 sm:p-8 ' +
                    (index % 2 === 1 ? 'border-l border-border ' : '') +
                    (index > 1 ? 'border-t border-border lg:border-t-0 ' : '') +
                    (index > 0 ? 'lg:border-l lg:border-border' : '')
                  }
                >
                  <div className="flex min-h-12 items-start sm:min-h-14">
                    <StatVisual kind={key} />
                  </div>
                  <div className="space-y-2">
                    <p
                      className="text-5xl leading-none tracking-[-0.03em] whitespace-nowrap text-fg sm:text-6xl"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      <CountUp value={t(`landing.stats.${key}.value`)} />
                    </p>
                    <p className="text-sm leading-snug text-fg-muted sm:text-base">
                      {t(`landing.stats.${key}.label`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
