import { BadgeIndianRupee, ShieldCheck, Shuffle, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const principles: readonly {
  key: 'offline' | 'privacy' | 'honest' | 'free';
  icon: LucideIcon;
}[] = [
  { key: 'offline', icon: WifiOff },
  { key: 'privacy', icon: ShieldCheck },
  { key: 'honest', icon: Shuffle },
  { key: 'free', icon: BadgeIndianRupee },
];

export function PrinciplesSection() {
  const { t } = useTranslation();

  return (
    <section
      id="principles"
      aria-labelledby="principles-title"
      className="snap-page relative flex scroll-mt-0 flex-col justify-center px-4 py-14 sm:px-8 sm:py-20 lg:min-h-dvh"
    >
      <div className="mx-auto w-full max-w-7xl">
        <Reveal>
          <SectionHeading
            id="principles-title"
            eyebrow={t('nav.principles')}
            title={t('landing.principles.title')}
            subtitle={t('landing.principles.subtitle')}
          />
        </Reveal>
        <ul className="mt-8 grid gap-4 sm:mt-14 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          {principles.map(({ key, icon: Icon }, index) => (
            <Reveal as="li" key={key} delay={index * 80} className="h-full">
              <div className="liquid-glass spotlight flex h-full flex-col gap-4 rounded-3xl p-5 transition-transform duration-300 hover:-translate-y-1 sm:gap-5 sm:p-7">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-300/15 text-amber-300">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <div className="space-y-2">
                  <h3
                    className="text-[1.75rem] leading-tight tracking-tight text-fg"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {t(`landing.principles.${key}.title`)}
                  </h3>
                  <p className="leading-relaxed text-fg-muted">
                    {t(`landing.principles.${key}.body`)}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
