import { GraduationCap, Landmark, MapPin, School } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RoleArt } from './illustrations';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const roles: readonly {
  key: 'crp' | 'teacher' | 'block' | 'family';
  icon: LucideIcon;
}[] = [
  { key: 'crp', icon: MapPin },
  { key: 'teacher', icon: School },
  { key: 'block', icon: Landmark },
  { key: 'family', icon: GraduationCap },
];

export function RolesSection() {
  const { t } = useTranslation();

  return (
    <section
      id="who-its-for"
      aria-labelledby="who-its-for-title"
      className="snap-page relative flex scroll-mt-0 flex-col justify-center px-4 py-14 sm:px-8 sm:py-20 lg:min-h-dvh"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end lg:gap-16">
          <Reveal>
            <SectionHeading
              id="who-its-for-title"
              eyebrow={t('nav.whoItsFor')}
              title={t('landing.roles.title')}
              className="max-w-3xl"
            />
          </Reveal>
          <Reveal delay={100}>
            <p className="max-w-sm text-base leading-relaxed text-fg-muted sm:text-lg">
              {t('landing.roles.subtitle')}
            </p>
          </Reveal>
        </div>

        <ul className="mt-8 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map(({ key, icon: Icon }, index) => (
            <Reveal as="li" key={key} delay={index * 80} className="h-full">
              <div className="liquid-glass spotlight group flex h-full flex-col gap-4 rounded-3xl p-4 transition-transform duration-300 hover:-translate-y-1 sm:gap-5">
                <div className="relative overflow-hidden rounded-2xl">
                  <RoleArt
                    kind={key}
                    className="h-28 w-full transition-transform duration-500 group-hover:scale-105 sm:h-32"
                  />
                  <span className="absolute bottom-2 left-2 flex size-9 items-center justify-center rounded-xl bg-black/35 text-primary backdrop-blur">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                </div>
                <div className="space-y-3 px-1 pb-1">
                  <h3
                    className="text-[1.75rem] leading-[1.05] tracking-tight text-fg"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {t(`landing.roles.${key}.title`)}
                  </h3>
                  <p className="text-[0.9375rem] leading-relaxed text-fg-muted">
                    {t(`landing.roles.${key}.body`)}
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
