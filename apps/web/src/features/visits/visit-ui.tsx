import { CalendarCheck, Lightbulb, ListChecks, Presentation } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { formatDay } from '@/features/attendance/dates';
import { cn } from '@/lib/cn';
import { textIn } from './observation-bank';
import type { Band, Reason } from './plan';
import type { Practice } from './practice-library';
import type { Visit } from './visit-change';
import { reasonText } from './visit-hooks';

export function BandBadge({ band }: { band: Band }) {
  const { t } = useTranslation();
  const tone = band === 'high' ? 'danger' : band === 'medium' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{t(`visits.band.${band}`)}</Badge>;
}

/** The reasons a class ranks where it does, in words. */
export function ReasonList({ reasons }: { reasons: readonly Reason[] }) {
  const { t, i18n } = useTranslation();
  if (reasons.length === 0) {
    return <p className="text-sm text-fg-muted">{t('visits.reason.none')}</p>;
  }
  return (
    <ul className="space-y-0.5 text-sm text-fg-muted">
      {reasons.map((reason) => (
        <li key={reason.kind}>{reasonText(reason, t, i18n.language)}</li>
      ))}
    </ul>
  );
}

export function ReadingLevelLabel({ level }: { level: string }) {
  const { t } = useTranslation();
  return <>{t(`visits.level.reading.${level}`, { defaultValue: level })}</>;
}

export function EnglishLevelLabel({ level }: { level: string }) {
  const { t } = useTranslation();
  return <>{t(`visits.level.english.${level}`, { defaultValue: level })}</>;
}

/** Why, how, the demonstration and the plan of a practice. */
export function PracticeDetails({
  practice,
  showPlan = true,
  className,
}: {
  practice: Practice;
  showPlan?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return (
    <div className={cn('space-y-4 text-sm', className)}>
      <p className="text-fg">{textIn(practice.why, language)}</p>
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 font-semibold text-fg">
          <ListChecks className="size-4 text-primary" aria-hidden="true" />
          {t('visits.practice.steps')}
        </h4>
        <ol className="list-decimal space-y-1 ps-5 text-fg">
          {practice.steps.map((step) => (
            <li key={step.en}>{textIn(step, language)}</li>
          ))}
        </ol>
      </div>
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 font-semibold text-fg">
          <Presentation className="size-4 text-primary" aria-hidden="true" />
          {t('visits.practice.demo')}
        </h4>
        <dl className="grid gap-2 sm:grid-cols-3">
          {(['iDo', 'weDo', 'youDo'] as const).map((part) => (
            <div key={part} className="rounded-lg bg-surface-muted p-3">
              <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {t(`visits.practice.${part}`)}
              </dt>
              <dd className="mt-1 text-fg">{textIn(practice.demo[part], language)}</dd>
            </div>
          ))}
        </dl>
      </div>
      {showPlan ? (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 font-semibold text-fg">
            <CalendarCheck className="size-4 text-primary" aria-hidden="true" />
            {t('visits.practice.plan')}
          </h4>
          <ul className="space-y-1 text-fg">
            {practice.plan.map((week) => (
              <li key={week.en}>{textIn(week, language)}</li>
            ))}
          </ul>
          <p className="flex items-start gap-2 text-fg-muted">
            <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t('visits.practice.lookFor')} {textIn(practice.lookFor, language)}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The teacher's practice card: the strength seen, the one step agreed, how to do it, the two-week
 * plan and the check-back date. Printable on one page.
 */
export function PracticeCard({
  visit,
  practice,
  classLabel,
  schoolName,
  teacherName,
}: {
  visit: Visit;
  practice: Practice;
  classLabel: string;
  schoolName: string;
  teacherName: string | null;
}) {
  const { i18n } = useTranslation();
  const feedback = visit.feedback;
  if (!feedback) {
    return null;
  }
  // Headings and content alike in the language of the card, so that a printed card is in one.
  const language = feedback.language;
  const t = i18n.getFixedT(language);
  return (
    <article className="practice-card space-y-4 rounded-xl border border-border bg-surface p-5">
      <header className="space-y-1 border-b border-border pb-3">
        <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {t('visits.card.title')}
        </p>
        <h3 className="text-lg font-bold text-fg">{textIn(practice.title, language)}</h3>
        <p className="text-sm text-fg-muted">
          {[teacherName, classLabel, schoolName].filter(Boolean).join(' · ')}
          {visit.visitedOn ? ` · ${formatDay(visit.visitedOn, language)}` : null}
        </p>
      </header>
      <section className="space-y-1">
        <h4 className="text-sm font-semibold text-fg">{t('visits.card.strength')}</h4>
        <p className="text-sm text-fg">{feedback.strength}</p>
      </section>
      <section className="space-y-1">
        <h4 className="text-sm font-semibold text-fg">{t('visits.card.step')}</h4>
        {feedback.changeNote ? <p className="text-sm text-fg">{feedback.changeNote}</p> : null}
        <ol className="list-decimal space-y-1 ps-5 text-sm text-fg">
          {practice.steps.map((step) => (
            <li key={step.en}>{textIn(step, language)}</li>
          ))}
        </ol>
        {feedback.technique ? (
          <p className="text-sm text-fg">
            <span className="font-medium">{t('visits.card.how')}</span> {feedback.technique}
          </p>
        ) : null}
      </section>
      <section className="space-y-1">
        <h4 className="text-sm font-semibold text-fg">{t('visits.card.plan')}</h4>
        <ul className="space-y-1 text-sm text-fg">
          {practice.plan.map((week) => (
            <li key={week.en}>{textIn(week, language)}</li>
          ))}
        </ul>
        {feedback.planNote ? <p className="text-sm text-fg">{feedback.planNote}</p> : null}
      </section>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
        {feedback.checkBackOn ? (
          <Badge tone="brand">
            {t('visits.card.checkBack', { date: formatDay(feedback.checkBackOn, language) })}
          </Badge>
        ) : null}
        <span className="text-fg-muted">
          {t('visits.card.lookFor')} {textIn(practice.lookFor, language)}
        </span>
      </footer>
    </article>
  );
}
