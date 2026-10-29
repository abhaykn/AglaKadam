import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  CircleCheck,
  FlaskConical,
  Hammer,
  LoaderCircle,
  MousePointerClick,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '@/components/layout/public-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { sessionStore } from '@/features/auth/session';
import { RoleArt } from '@/features/landing/illustrations';
import { getEnv } from '@/lib/env';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  DEMO_ROLES,
  DemoError,
  myDemoQuery,
  signInWithDemoToken,
  startDemo,
  type DemoRole,
} from './demo-api';
import { DEMO_ROLE_ICONS, ROLE_SEES } from './demo-roles';
import { reloadAt, useLeaveDemo } from './demo-session';

/** What the district is doing while it is built, shown one after another. */
const ROLE_ART = { teacher: 'teacher', crp: 'crp', officer: 'block', family: 'family' } as const;
const BUILD_STEPS = [
  'places',
  'children',
  'attendance',
  'pulse',
  'visits',
  'exams',
  'signIn',
] as const;
const STEP_MS = 2200;

function RoleCard({
  role,
  index,
  selected,
  onSelect,
}: {
  role: DemoRole;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const Icon = DEMO_ROLE_ICONS[role];
  const id = useId();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      // Named by the role, and described by the person and what they see.
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-person ${id}-sees`}
      onClick={onSelect}
      className={cn(
        'liquid-glass spotlight animate-fade-rise relative flex h-full flex-col gap-3 rounded-3xl p-4 text-left transition-[transform,box-shadow] duration-300',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        selected
          ? 'shadow-[0_0_44px_-6px_rgb(124_200_242/0.55)] ring-2 ring-primary'
          : 'hover:-translate-y-1 active:scale-[0.99]',
      )}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <span className="relative block overflow-hidden rounded-2xl">
        <RoleArt
          kind={ROLE_ART[role]}
          className={cn(
            'h-24 w-full transition-transform duration-500 sm:h-28',
            selected ? 'scale-105' : 'opacity-90',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-primary text-primary-fg shadow-md transition-all duration-300',
            selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
          )}
        >
          <Check className="size-4" />
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-11 items-center justify-center rounded-xl',
            selected ? 'bg-primary text-primary-fg' : 'bg-primary-soft text-primary-soft-fg',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span>
          <span id={`${id}-title`} className="block font-semibold text-fg">
            {t(`demo.roles.${role}.title`)}
          </span>
          <span id={`${id}-person`} className="block text-sm text-fg-muted">
            {t(`demo.roles.${role}.person`)}
          </span>
        </span>
      </span>
      {/* A button holds phrasing content only, so the list is made of spans. */}
      <span id={`${id}-sees`} className="block space-y-1.5 text-sm text-fg">
        {ROLE_SEES[role].map((key) => (
          <span key={key} className="flex gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{t(key)}</span>
            {/* Keeps the items apart when read aloud; a flex row does not show it. */}{' '}
          </span>
        ))}
      </span>
    </button>
  );
}

function Building({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <div className="liquid-glass space-y-5 rounded-3xl p-6 sm:p-8" aria-live="polite">
      <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-primary to-amber-300 transition-[width] duration-700 ease-out"
          style={{ width: `${((step + 1) / BUILD_STEPS.length) * 100}%` }}
        />
      </span>
      <div className="flex items-center gap-3">
        <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold text-fg">{t('demo.building.title')}</p>
          <p className="text-sm text-fg-muted">{t('demo.building.note')}</p>
        </div>
      </div>
      <ol className="space-y-2">
        {BUILD_STEPS.map((key, index) => (
          <li
            key={key}
            className={cn(
              'flex items-center gap-2 text-sm',
              index < step ? 'text-fg' : index === step ? 'font-medium text-fg' : 'text-fg-subtle',
            )}
          >
            {index < step ? (
              <CircleCheck className="size-4 text-success" aria-hidden="true" />
            ) : index === step ? (
              <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
            ) : (
              <span className="size-4 rounded-full border border-border" aria-hidden="true" />
            )}
            {t(`demo.building.${key}`)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Shown to a visitor whose demonstration account is signed in on this device. */
function ContinueDemo() {
  const { t } = useTranslation();
  const demo = useQuery(myDemoQuery());
  const leave = useLeaveDemo();
  const [leaving, setLeaving] = useState(false);
  if (demo.isPending) {
    return (
      <LoaderCircle className="size-6 animate-spin text-primary" aria-label={t('app.loading')} />
    );
  }
  if (!demo.data) {
    return (
      <Alert tone="info" title={t('demo.signedIn.title')}>
        <p>{t('demo.signedIn.body')}</p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/app">{t('demo.signedIn.back')}</Link>
        </Button>
      </Alert>
    );
  }
  const role = t(`demo.roleName.${demo.data.role}`);
  return (
    <div className="liquid-glass space-y-4 rounded-3xl p-6 sm:p-8">
      <p className="font-semibold text-fg">{t('demo.continue.title')}</p>
      <p className="text-sm text-fg-muted">{t('demo.continue.body', { role })}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link to="/app">
            {t('demo.continue.go', { role })}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button
          variant="secondary"
          isLoading={leaving}
          onClick={() => {
            setLeaving(true);
            void leave(null).catch(() => setLeaving(false));
          }}
        >
          {t('demo.continue.newOne')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The way in for anyone trying the application: choose a role, and a district of one's own is
 * built and opened, with no account to create.
 */
export function DemoPage({ initialRole }: { initialRole: DemoRole | null }) {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('demo.page.title'));
  const session = useStore(sessionStore);
  const [role, setRole] = useState<DemoRole | null>(initialRole);
  const [language, setLanguage] = useState<'hi' | 'en'>(i18n.language === 'en' ? 'en' : 'hi');
  const [building, setBuilding] = useState(false);
  const [step, setStep] = useState(0);
  const [failure, setFailure] = useState<DemoError | null>(null);

  useEffect(() => {
    if (!building) {
      return;
    }
    const timer = setInterval(() => {
      setStep((current) => Math.min(current + 1, BUILD_STEPS.length - 1));
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [building]);

  const open = async () => {
    if (!role) {
      return;
    }
    setFailure(null);
    setStep(0);
    setBuilding(true);
    try {
      const token = await startDemo(role, language);
      setStep(BUILD_STEPS.length - 1);
      await signInWithDemoToken(token);
      reloadAt('/app');
    } catch (error) {
      setBuilding(false);
      setFailure(error instanceof DemoError ? error : new DemoError('unexpected'));
    }
  };

  const failureText = (error: DemoError) =>
    error.reason === 'throttled'
      ? t('demo.errors.throttled', {
          minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 3600) / 60)),
        })
      : t(`demo.errors.${error.reason}`);

  return (
    <PublicLayout>
      <section className="relative container-page max-w-6xl space-y-10 py-10 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 left-1/2 h-72 w-[min(40rem,100%)] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative space-y-5">
          <p className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-primary">
            <FlaskConical className="size-4" aria-hidden="true" />
            {t('demo.page.eyebrow')}
          </p>
          <h1 className="max-w-3xl text-5xl leading-[0.98] text-balance text-fg sm:text-7xl">
            {t('demo.page.title')}
          </h1>
          <p className="max-w-3xl text-base leading-relaxed text-fg-muted sm:text-lg">
            {t('demo.page.lead')}
          </p>
          <ol
            aria-label={t('demo.page.steps.label')}
            className="flex flex-wrap items-center gap-3 pt-2"
          >
            {(
              [
                { key: 'pick', icon: MousePointerClick },
                { key: 'build', icon: Hammer },
                { key: 'explore', icon: Rocket },
              ] as const
            ).map(({ key, icon: StepIcon }, index) => (
              <li
                key={key}
                className="liquid-glass animate-fade-rise flex items-center gap-3 rounded-full py-2 pr-5 pl-2 text-sm text-fg"
                style={{ animationDelay: `${index * 140 + 200}ms` }}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-fg">
                  <StepIcon className="size-4" aria-hidden="true" />
                </span>
                {t(`demo.page.steps.${key}`)}
              </li>
            ))}
          </ol>
        </div>

        {!getEnv().demoWorkspaceEnabled ? (
          <Alert tone="info">{t('demo.errors.unavailable')}</Alert>
        ) : session.status === 'signed-in' ? (
          <ContinueDemo />
        ) : building ? (
          <Building step={step} />
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 id="demo-role" className="text-lg font-semibold text-fg">
                {t('demo.page.chooseRole')}
              </h2>
              <div
                role="radiogroup"
                aria-labelledby="demo-role"
                className="grid gap-4 sm:grid-cols-2"
              >
                {DEMO_ROLES.map((entry, index) => (
                  <RoleCard
                    key={entry}
                    index={index}
                    role={entry}
                    selected={role === entry}
                    onSelect={() => setRole(entry)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span id="demo-language" className="text-sm font-medium text-fg">
                {t('demo.page.language')}
              </span>
              <div
                role="radiogroup"
                aria-labelledby="demo-language"
                className="liquid-glass relative inline-flex h-11 rounded-full p-1"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-md shadow-black/20 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
                  style={{ transform: `translateX(${language === 'hi' ? 0 : 100}%)` }}
                />
                {(['hi', 'en'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={language === option}
                    onClick={() => setLanguage(option)}
                    className={cn(
                      'relative z-10 min-w-24 rounded-full px-4 text-sm font-medium transition-colors duration-300',
                      language === option
                        ? 'text-[hsl(201_100%_13%)]'
                        : 'text-white/75 hover:text-white',
                    )}
                  >
                    {option === 'hi' ? 'हिंदी' : 'English'}
                  </button>
                ))}
              </div>
            </div>

            {failure ? (
              <Alert tone="danger" assertive>
                {failureText(failure)}
              </Alert>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={!role}
                onClick={() => void open()}
                className="liquid-glass btn-shine btn-arrow btn-glow inline-flex items-center justify-center gap-2 rounded-full bg-[hsl(201_100%_13%/0.38)]! px-9 py-4 text-base font-medium text-white backdrop-blur-md! transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:scale-100 disabled:[animation:none] disabled:opacity-55"
              >
                {role
                  ? t('demo.page.startAs', { role: t(`demo.roleName.${role}`) })
                  : t('demo.page.start')}
                <ArrowRight className="size-5" aria-hidden="true" />
              </button>
              {!role ? <p className="text-sm text-fg-muted">{t('demo.page.pickFirst')}</p> : null}
            </div>
          </div>
        )}

        <p className="inline-flex items-start gap-2 text-sm text-fg-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('demo.page.simulated')}
        </p>
      </section>
    </PublicLayout>
  );
}
