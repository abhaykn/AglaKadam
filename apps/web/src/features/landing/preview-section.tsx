import { CalendarCheck, Check, ListOrdered, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/brand/logo';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const points: readonly { key: 'ranked' | 'offline' | 'nextStep'; icon: LucideIcon }[] = [
  { key: 'ranked', icon: ListOrdered },
  { key: 'offline', icon: WifiOff },
  { key: 'nextStep', icon: CalendarCheck },
];

const visits = [
  { key: 'first', tone: 'bg-amber-300 text-black', width: '82%' },
  { key: 'second', tone: 'bg-primary text-primary-fg', width: '58%' },
  { key: 'third', tone: 'bg-white/20 text-white', width: '36%' },
] as const;

/** A phone showing the weekly visit plan, drawn in markup so it stays sharp and translated. */
function PhoneMockup() {
  const { t } = useTranslation();

  return (
    <div className="relative mx-auto w-[16.5rem] sm:w-[19rem]">
      <div
        aria-hidden="true"
        className="absolute -inset-10 rounded-full [background:radial-gradient(closest-side,color-mix(in_srgb,var(--primary)_28%,transparent),transparent)]"
        style={{ animation: 'vg-pulse 5s ease-in-out infinite' }}
      />
      <div
        role="img"
        aria-label={t('landing.preview.phone.label')}
        className="relative rotate-[3deg] rounded-[2.4rem] border-[9px] border-[#07182a] bg-[#07182a] shadow-2xl ring-1 shadow-black/50 ring-white/20 transition-transform duration-500 hover:rotate-0"
      >
        <div className="absolute top-2 left-1/2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-black" />
        <div className="overflow-hidden rounded-[1.7rem] bg-gradient-to-b from-[#0c3f63] to-[#082a46] px-4 pt-9 pb-5">
          <div className="flex items-center gap-2">
            <LogoMark className="size-7" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {t('landing.preview.phone.title')}
              </p>
              <p className="truncate text-[0.7rem] text-white/60">
                {t('landing.preview.phone.subtitle')}
              </p>
            </div>
          </div>

          <ul className="mt-4 space-y-2.5">
            {visits.map((visit, index) => (
              <li key={visit.key} className="rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[0.8rem] font-medium text-white">
                      {t(`landing.preview.phone.visits.${visit.key}.name`)}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[0.68rem] leading-snug text-white/60">
                      {t(`landing.preview.phone.visits.${visit.key}.note`)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-medium ${visit.tone}`}
                  >
                    {t(`landing.preview.phone.visits.${visit.key}.tag`)}
                  </span>
                </div>
                <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="stat-bar block h-full rounded-full bg-primary"
                    style={
                      { width: visit.width, '--d': `${600 + index * 250}ms` } as React.CSSProperties
                    }
                  />
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[0.65rem] text-white/60">
            <Check className="size-3 text-primary" aria-hidden="true" />
            {t('landing.preview.phone.synced')}
          </div>
        </div>
      </div>

      <span
        aria-hidden="true"
        className="liquid-glass absolute top-16 -left-6 hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs text-white sm:inline-flex lg:-left-12"
        style={
          { animation: 'float-slow 7s ease-in-out infinite', '--r': '0deg' } as React.CSSProperties
        }
      >
        <WifiOff className="size-4 text-amber-300" />
        {t('landing.preview.chips.offline')}
      </span>
      <span
        aria-hidden="true"
        className="liquid-glass absolute -right-4 bottom-24 hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs text-white sm:inline-flex lg:-right-10"
        style={
          {
            animation: 'float-slow 8s ease-in-out -3s infinite',
            '--r': '0deg',
          } as React.CSSProperties
        }
      >
        <Check className="size-4 text-primary" />
        {t('landing.preview.chips.names')}
      </span>
    </div>
  );
}

/** Shows the product itself, so the page is more than numbers and promises. */
export function PreviewSection() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="preview-title"
      className="snap-page relative flex flex-col justify-center px-4 py-14 sm:px-8 sm:py-20 lg:min-h-dvh"
    >
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <div>
          <Reveal>
            <SectionHeading
              id="preview-title"
              eyebrow={t('landing.preview.eyebrow')}
              title={t('landing.preview.title')}
              subtitle={t('landing.preview.body')}
            />
          </Reveal>
          <ul className="mt-10 space-y-3">
            {points.map(({ key, icon: Icon }, index) => (
              <Reveal as="li" key={key} delay={index * 110}>
                <div className="liquid-glass flex items-center gap-4 rounded-2xl px-5 py-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="text-base text-fg">{t(`landing.preview.points.${key}`)}</span>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={150}>
          <PhoneMockup />
        </Reveal>
      </div>
    </section>
  );
}
