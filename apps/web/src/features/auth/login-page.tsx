import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, FlaskConical, Languages, LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { useId, useState, type PointerEvent, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { EducationBackdrop } from '@/components/layout/education-backdrop';
import { PublicHeader } from '@/components/layout/public-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, PasswordInput } from '@/components/ui/input';
import { useOnlineStatus } from '@/features/connectivity/use-online-status';
import { cn } from '@/lib/cn';
import { getEnv } from '@/lib/env';
import { NightReadingScene } from '@/features/landing/illustrations';
import { useDocumentTitle } from '@/lib/use-document-title';
import { signInFamily, signInStaff, SignInError, type SignInFailure } from './sign-in';

type Audience = 'staff' | 'family';

function useFailureMessage() {
  const { t } = useTranslation();
  return (reason: SignInFailure, retryAfterSeconds: number | null, audience: Audience): string => {
    switch (reason) {
      case 'invalid_identifier':
        return t('auth.errors.invalidMobile');
      case 'invalid_credentials':
        return audience === 'staff'
          ? t('auth.errors.staffInvalidCredentials')
          : t('auth.errors.familyInvalidCredentials');
      case 'account_blocked':
        return t('auth.errors.accountBlocked');
      case 'locked':
        return t('auth.errors.locked', {
          minutes: Math.max(1, Math.ceil((retryAfterSeconds ?? 900) / 60)),
        });
      case 'throttled':
        return t('auth.errors.throttled', {
          minutes: Math.max(1, Math.ceil((retryAfterSeconds ?? 3600) / 60)),
        });
      case 'rate_limited':
        return t('auth.errors.rateLimited');
      case 'network':
        return t('auth.errors.network');
      case 'unexpected':
        return t('auth.errors.unexpected');
    }
  };
}

interface FormProps {
  onSignedIn: () => void;
}

function StaffForm({ onSignedIn }: FormProps) {
  const { t } = useTranslation();
  const describeFailure = useFailureMessage();
  // The first super administrator signs in with an email address; everyone else with a mobile
  // number. The choice only changes the keyboard and the wording: either form is accepted.
  const [usesEmail, setUsesEmail] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const switchIdentifier = () => {
    setUsesEmail((current) => !current);
    setIdentifier('');
    setError(null);
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (identifier.trim() === '' || password === '') {
      setError(t('auth.errors.missingFields'));
      return;
    }
    setSubmitting(true);
    try {
      await signInStaff(identifier, password);
      onSignedIn();
    } catch (failure) {
      if (failure instanceof SignInError && failure.reason === 'invalid_identifier' && usesEmail) {
        setError(t('auth.errors.invalidEmail'));
      } else {
        setError(
          failure instanceof SignInError
            ? describeFailure(failure.reason, failure.retryAfterSeconds, 'staff')
            : t('auth.errors.unexpected'),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="stagger space-y-5" noValidate>
      {error ? (
        <Alert tone="danger" assertive>
          {error}
        </Alert>
      ) : null}
      <div className="space-y-2">
        <Field
          label={usesEmail ? t('auth.staff.emailLabel') : t('auth.staff.identifierLabel')}
          hint={usesEmail ? t('auth.staff.emailHint') : t('auth.staff.identifierHint')}
        >
          <Input
            name="username"
            type={usesEmail ? 'email' : 'text'}
            autoComplete="username"
            inputMode={usesEmail ? 'email' : 'tel'}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            disabled={isSubmitting}
          />
        </Field>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="min-h-10"
          onClick={switchIdentifier}
          disabled={isSubmitting}
        >
          {usesEmail ? t('auth.staff.useMobile') : t('auth.staff.useEmail')}
        </Button>
      </div>
      <Field label={t('auth.passwordLabel')}>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="btn-shine w-full"
        isLoading={isSubmitting}
        leadingIcon={<LogIn aria-hidden="true" />}
      >
        {t('common.signIn')}
      </Button>
      <p className="text-sm text-fg-muted">{t('auth.staff.forgotPassword')}</p>
    </form>
  );
}

function FamilyForm({ onSignedIn }: FormProps) {
  const { t } = useTranslation();
  const describeFailure = useFailureMessage();
  const [learnerCode, setLearnerCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const code = learnerCode.replace(/\s/g, '');
    if (!/^\d{10}$/.test(code)) {
      setError(t('auth.errors.invalidLearnerCode'));
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError(t('auth.errors.invalidPin'));
      return;
    }
    setSubmitting(true);
    try {
      await signInFamily(code, pin);
      onSignedIn();
    } catch (failure) {
      setError(
        failure instanceof SignInError
          ? describeFailure(failure.reason, failure.retryAfterSeconds, 'family')
          : t('auth.errors.unexpected'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="stagger space-y-5" noValidate>
      {error ? (
        <Alert tone="danger" assertive>
          {error}
        </Alert>
      ) : null}
      <Field label={t('auth.family.learnerCodeLabel')} hint={t('auth.family.learnerCodeHint')}>
        <Input
          name="learner-code"
          autoComplete="username"
          inputMode="numeric"
          maxLength={14}
          value={learnerCode}
          onChange={(event) => setLearnerCode(event.target.value)}
          disabled={isSubmitting}
        />
      </Field>
      <Field label={t('auth.family.pinLabel')}>
        <PasswordInput
          name="pin"
          autoComplete="current-password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          disabled={isSubmitting}
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="btn-shine w-full"
        isLoading={isSubmitting}
        leadingIcon={<LogIn aria-hidden="true" />}
      >
        {t('common.signIn')}
      </Button>
      <p className="text-sm text-fg-muted">{t('auth.family.help')}</p>
    </form>
  );
}

/** Tilts the artwork panel towards the pointer, a few degrees at most. */
function tiltPanel(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType !== 'mouse') {
    return;
  }
  const panel = event.currentTarget;
  const box = panel.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width - 0.5;
  const y = (event.clientY - box.top) / box.height - 0.5;
  panel.style.transform = `perspective(1200px) rotateY(${(x * 5).toFixed(2)}deg) rotateX(${(-y * 4).toFixed(2)}deg)`;
}

function resetPanel(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.style.transform = '';
}

interface LoginPageProps {
  redirectTo?: string | undefined;
}

export function LoginPage({ redirectTo }: LoginPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [audience, setAudience] = useState<Audience>('staff');
  const tabsId = useId();
  useDocumentTitle(t('auth.title'));

  const onSignedIn = () => {
    const target = redirectTo?.startsWith('/app') ? redirectTo : '/app';
    void navigate({ to: target, replace: true });
  };

  const tabs: { value: Audience; label: string }[] = [
    { value: 'staff', label: t('auth.tabs.staff') },
    { value: 'family', label: t('auth.tabs.family') },
  ];

  return (
    <div
      data-theme="dark"
      className="theme-night night-backdrop relative flex min-h-dvh flex-col overflow-x-clip"
    >
      <EducationBackdrop />
      <PublicHeader />

      <main
        id="main-content"
        className="page-enter relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:py-12"
      >
        <div className="mx-auto grid w-full max-w-6xl items-stretch gap-12 lg:grid-cols-[1fr_28rem] lg:gap-16">
          <aside
            className="liquid-glass relative hidden min-h-[34rem] overflow-hidden rounded-3xl transition-transform duration-200 ease-out will-change-transform lg:block"
            onPointerMove={tiltPanel}
            onPointerLeave={resetPanel}
          >
            <NightReadingScene className="absolute inset-0 h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-b from-[hsl(201_100%_9%/0.85)] via-transparent to-transparent" />
            <span aria-hidden="true" className="shooting-star" />
            <span aria-hidden="true" className="shooting-star shooting-star-late" />
            <div className="relative p-10">
              <p
                className="text-5xl leading-[0.98] tracking-[-0.03em] text-balance text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {t('landing.hero.title')
                  .split(' ')
                  .map((word, index) => (
                    <span
                      key={`${word}-${index}`}
                      className="animate-fade-rise mr-[0.22em] inline-block"
                      style={{ animationDelay: `${index * 70 + 150}ms` }}
                    >
                      {word}
                    </span>
                  ))}
              </p>
              <p
                className="animate-fade-rise mt-5 max-w-sm text-base leading-relaxed text-white/70"
                style={{ animationDelay: '700ms' }}
              >
                {t('landing.hero.note')}
              </p>
            </div>
            <ul className="absolute right-6 bottom-6 left-6 flex flex-wrap gap-2">
              {[
                { icon: WifiOff, label: t('landing.stats.tags.offline') },
                { icon: Languages, label: t('landing.stats.tags.bilingual') },
                { icon: ShieldCheck, label: t('landing.principles.privacy.title') },
              ].map(({ icon: Icon, label }, index) => (
                <li
                  key={label}
                  className="liquid-glass animate-fade-rise inline-flex items-center gap-2 rounded-full bg-black/30! px-3.5 py-2 text-sm text-white backdrop-blur-md!"
                  style={{ animationDelay: `${index * 120 + 300}ms` }}
                >
                  <Icon className="size-4 text-primary" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </aside>
          <div className="w-full max-w-md justify-self-center">
            <h1
              className="text-4xl font-normal text-fg sm:text-5xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {t('auth.title')}
            </h1>
            <p className="mt-1 text-fg-muted">{t('auth.subtitle')}</p>

            <div className="liquid-glass card-aurora animate-fade-rise mt-6 rounded-3xl p-5 sm:p-7">
              <div
                role="tablist"
                aria-label={t('auth.tabs.label')}
                className="liquid-glass relative mb-6 grid h-12 grid-cols-2 rounded-full p-1"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-md shadow-black/20 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
                  style={{ transform: `translateX(${audience === 'staff' ? 0 : 100}%)` }}
                />
                {tabs.map((tab) => {
                  const selected = tab.value === audience;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      id={`${tabsId}-${tab.value}-tab`}
                      aria-selected={selected}
                      aria-controls={`${tabsId}-${tab.value}-panel`}
                      onClick={() => setAudience(tab.value)}
                      className={cn(
                        'relative z-10 rounded-full text-sm font-medium transition-colors duration-300',
                        selected ? 'text-[hsl(201_100%_13%)]' : 'text-white/75 hover:text-white',
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {!isOnline ? (
                <Alert tone="warning" className="mb-5" title={t('auth.offlineTitle')}>
                  <span className="inline-flex items-start gap-2">
                    <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {t('auth.offlineBody')}
                  </span>
                </Alert>
              ) : null}

              <div
                role="tabpanel"
                id={`${tabsId}-${audience}-panel`}
                aria-labelledby={`${tabsId}-${audience}-tab`}
              >
                {audience === 'staff' ? (
                  <StaffForm onSignedIn={onSignedIn} />
                ) : (
                  <FamilyForm onSignedIn={onSignedIn} />
                )}
              </div>
            </div>

            {getEnv().demoWorkspaceEnabled ? (
              <Link
                to="/demo"
                className="liquid-glass spotlight group btn-arrow mt-5 flex items-center gap-3 rounded-2xl p-4 text-sm text-fg transition-transform hover:-translate-y-0.5"
              >
                <FlaskConical className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{t('demo.login.title')}</span>
                  <span className="block text-fg-muted">{t('demo.login.body')}</span>
                </span>
                <ArrowRight className="ml-auto size-5 shrink-0 text-primary" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
