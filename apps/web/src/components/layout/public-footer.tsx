import { Link } from '@tanstack/react-router';
import { ArrowUp, FlaskConical, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/brand/logo';
import { getEnv } from '@/lib/env';
import { FooterHills } from './footer-hills';

const sectionLinks = [
  { hash: 'how-it-works', key: 'nav.howItWorks' },
  { hash: 'who-its-for', key: 'nav.whoItsFor' },
  { hash: 'principles', key: 'nav.principles' },
] as const;

const linkClass =
  'group inline-flex min-h-10 items-center gap-2 text-sm text-fg-muted transition-colors hover:text-fg';

export function PublicFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const demoEnabled = getEnv().demoWorkspaceEnabled;

  return (
    <footer className="relative mt-10 overflow-hidden border-t border-white/10 bg-[hsl(201_100%_7%/0.92)]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
      />
      <FooterHills />

      <div className="relative mx-auto w-full max-w-7xl px-4 pt-14 sm:px-8 sm:pt-20">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div className="space-y-5">
            <span className="flex items-center gap-3">
              <LogoMark className="size-11" />
              <span
                className="text-4xl leading-none tracking-tight text-fg"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {t('common.appName')}
              </span>
            </span>
            <p className="max-w-sm text-base leading-relaxed text-fg-muted">
              {t('landing.footer.alignment')}
            </p>
          </div>

          <nav aria-label={t('landing.footer.explore')} className="space-y-4">
            <p className="text-xs font-medium tracking-[0.14em] text-primary uppercase">
              {t('landing.footer.explore')}
            </p>
            <ul className="space-y-3">
              {sectionLinks.map((link) => (
                <li key={link.hash}>
                  <Link to="/" hash={link.hash} className={linkClass}>
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t('landing.footer.start')} className="space-y-4">
            <p className="text-xs font-medium tracking-[0.14em] text-primary uppercase">
              {t('landing.footer.start')}
            </p>
            <ul className="space-y-3">
              {demoEnabled ? (
                <li>
                  <Link to="/demo" className={linkClass}>
                    <FlaskConical className="size-4" aria-hidden="true" />
                    {t('demo.open')}
                  </Link>
                </li>
              ) : null}
              <li>
                <Link to="/login" className={linkClass}>
                  <LogIn className="size-4" aria-hidden="true" />
                  {t('common.signIn')}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>{t('landing.footer.privacy')}</p>
            <p>{t('landing.footer.rights', { year })}</p>
          </div>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="liquid-glass inline-flex w-fit items-center gap-2 rounded-full px-5 py-2.5 text-fg transition-transform hover:scale-[1.03]"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
            {t('landing.footer.backToTop')}
          </button>
        </div>
      </div>
    </footer>
  );
}
