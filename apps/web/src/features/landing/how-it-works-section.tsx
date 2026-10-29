import { Activity, ClipboardCheck, MessagesSquare, RotateCcw, Route } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { LoopDiagram } from './loop-diagram';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const steps: readonly {
  key: 'pulse' | 'plan' | 'observe' | 'coach' | 'followUp';
  icon: LucideIcon;
}[] = [
  { key: 'pulse', icon: Activity },
  { key: 'plan', icon: Route },
  { key: 'observe', icon: ClipboardCheck },
  { key: 'coach', icon: MessagesSquare },
  { key: 'followUp', icon: RotateCcw },
];

const STEP_MS = 7000;

/**
 * The loop as an accordion that fits one screen: one step open at a time, moving on by itself until
 * the visitor picks a step, with the diagram following the open step.
 */
export function HowItWorksSection() {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (!auto) {
      return;
    }
    const timer = window.setTimeout(
      () => setActive((current) => (current + 1) % steps.length),
      STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [auto, active]);

  const choose = (index: number) => {
    setAuto(false);
    setActive(index);
  };

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="snap-page relative flex scroll-mt-0 flex-col justify-center px-4 py-14 sm:px-8 sm:py-20 lg:min-h-dvh lg:py-8"
    >
      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <Reveal>
            <SectionHeading
              id="how-it-works-title"
              eyebrow={t('nav.howItWorks')}
              title={t('landing.loop.title')}
              subtitle={t('landing.loop.subtitle')}
            />
          </Reveal>

          <ol className="mt-6 space-y-2">
            {steps.map(({ key, icon: Icon }, index) => {
              const isOpen = index === active;
              return (
                <Reveal as="li" key={key} delay={index * 70}>
                  <div
                    className={cn(
                      'relative overflow-hidden rounded-2xl border transition-colors duration-500',
                      isOpen ? 'border-primary/50 bg-surface' : 'border-border bg-transparent',
                    )}
                  >
                    <span
                      className="pointer-events-none absolute top-[1.4rem] right-5 text-xs font-medium text-fg-subtle tabular-nums"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`step-${key}`}
                        onClick={() => choose(index)}
                        className="flex w-full items-center gap-4 px-5 py-3 text-left"
                      >
                        <span
                          className={cn(
                            'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-500',
                            isOpen
                              ? 'bg-primary text-primary-fg'
                              : 'bg-surface-sunken text-fg-muted',
                          )}
                        >
                          <Icon className="size-5" aria-hidden="true" />
                        </span>
                        <span
                          className={cn(
                            'text-3xl leading-none tracking-tight transition-colors duration-500',
                            isOpen ? 'text-fg' : 'text-fg-muted',
                          )}
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {t(`landing.loop.steps.${key}.title`)}
                        </span>
                      </button>
                    </h3>
                    <div
                      id={`step-${key}`}
                      className={cn(
                        'grid transition-[grid-template-rows] duration-500 ease-out',
                        isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}
                    >
                      <div className="overflow-hidden">
                        <p className="px-5 pb-5 pl-[4.5rem] text-[0.9375rem] leading-relaxed text-fg-muted">
                          {t(`landing.loop.steps.${key}.body`)}
                        </p>
                      </div>
                    </div>
                    {isOpen && auto ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
                        style={{ animation: `step-progress ${STEP_MS}ms linear both` }}
                      />
                    ) : null}
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </div>

        <Reveal delay={150} className="liquid-glass hidden rounded-3xl p-8 lg:block">
          <LoopDiagram activeIndex={active} />
          <p className="mt-2 text-center text-sm text-fg-muted">{t('landing.loop.note')}</p>
        </Reveal>
      </div>
    </section>
  );
}
