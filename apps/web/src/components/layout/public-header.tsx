import { Link } from '@tanstack/react-router';
import { FlaskConical, Menu, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/cn';
import { getEnv } from '@/lib/env';
import { scrollToElement } from '@/lib/smooth-scroll';
import { InstallButton } from './install-button';
import { LanguageSwitch } from './language-switch';

const sectionLinks = [
  { hash: 'how-it-works', key: 'nav.howItWorks' },
  { hash: 'who-its-for', key: 'nav.whoItsFor' },
  { hash: 'principles', key: 'nav.principles' },
] as const;

const glass = 'liquid-glass btn-shine rounded-full px-5 py-2.5 text-sm text-white';

/** Scrolls to a section of the landing page smoothly when it is already on screen. */
function goToSection(hash: string, event: MouseEvent, afterwards?: () => void): void {
  afterwards?.();
  const target = document.getElementById(hash);
  if (target) {
    event.preventDefault();
    scrollToElement(target);
    history.replaceState(null, '', `#${hash}`);
  }
}

/**
 * Navigation for public pages. It sits clear over the hero, turns into a frosted bar once the page
 * moves, tucks away while reading downwards, and returns as soon as the visitor scrolls back up.
 */
export function PublicHeader() {
  const { t } = useTranslation();
  const demoEnabled = getEnv().demoWorkspaceEnabled;
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    let settle = 0;
    let lastY = window.scrollY;
    // Which section is being read: measured only once scrolling pauses, so that nothing is
    // measured (and no layout forced) while the page is moving.
    const findActive = () => {
      let current: string | null = null;
      for (const link of sectionLinks) {
        const section = document.getElementById(link.hash);
        if (section && section.getBoundingClientRect().top <= window.innerHeight * 0.4) {
          current = link.hash;
        }
      }
      setActive(current);
    };
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 24);
      if (y > lastY + 4 && y > 260) {
        setHidden(true);
      } else if (y < lastY - 4 || y <= 260) {
        setHidden(false);
      }
      lastY = y;
      window.clearTimeout(settle);
      settle = window.setTimeout(findActive, 120);
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    findActive();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transform-gpu transition-transform duration-300 ease-out will-change-transform',
        hidden && !menuOpen && '-translate-y-full',
      )}
    >
      <div className="relative">
        {/* The bar behind the navigation fades in and out; nothing but its opacity changes while
            the page scrolls, and it has no blur, so scrolling stays smooth. */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 border-b border-white/10 bg-[hsl(201_100%_9%/0.94)] shadow-lg shadow-black/20 transition-opacity duration-300',
            scrolled || menuOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <nav
          aria-label={t('common.appName')}
          className={cn(
            'relative mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] sm:px-8',
          )}
        >
          <Link
            to="/"
            aria-label={t('common.homeLink')}
            className="flex items-center gap-2.5 transition-transform hover:scale-[1.02]"
          >
            <LogoMark className="size-9" />
            <span
              className="hidden text-2xl leading-none tracking-tight text-white min-[380px]:inline sm:text-3xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {t('common.appName')}
            </span>
          </Link>

          <ul className="hidden items-center gap-1 lg:flex">
            {sectionLinks.map((link) => (
              <li key={link.hash}>
                <Link
                  to="/"
                  hash={link.hash}
                  onClick={(event) => goToSection(link.hash, event)}
                  aria-current={active === link.hash ? 'location' : undefined}
                  className={cn(
                    'relative block px-4 py-2 text-sm transition-colors',
                    active === link.hash ? 'text-white' : 'text-white/65 hover:text-white',
                  )}
                >
                  {t(link.key)}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-x-4 bottom-0.5 h-0.5 origin-left rounded-full bg-primary transition-transform duration-300',
                      active === link.hash ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitch variant="glass" />
            <div className="hidden xl:block">
              <InstallButton compact />
            </div>
            {demoEnabled ? (
              <Link to="/demo" className={`${glass} hidden items-center gap-2 lg:inline-flex`}>
                <FlaskConical className="size-4" aria-hidden="true" />
                {t('demo.open')}
              </Link>
            ) : null}
            <Link
              to="/login"
              className="btn-solid btn-shine rounded-full px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-transform hover:scale-[1.03] active:scale-[0.97] sm:px-5"
            >
              {t('common.signIn')}
            </Link>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="public-menu"
              aria-label={t(menuOpen ? 'common.close' : 'common.openMenu')}
              onClick={() => setMenuOpen((open) => !open)}
              className="liquid-glass flex size-10 items-center justify-center rounded-full text-white lg:hidden"
            >
              {menuOpen ? (
                <X className="size-5" aria-hidden="true" />
              ) : (
                <Menu className="size-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </nav>

        {menuOpen ? (
          <div id="public-menu" className="page-enter relative px-4 pb-4 lg:hidden">
            <ul className="space-y-1 rounded-2xl bg-white/[0.06] p-2 ring-1 ring-white/10">
              {sectionLinks.map((link) => (
                <li key={link.hash}>
                  <Link
                    to="/"
                    hash={link.hash}
                    onClick={(event) => goToSection(link.hash, event, () => setMenuOpen(false))}
                    className="block rounded-xl px-4 py-3 text-base text-white/90 transition-colors hover:bg-white/10"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
              {demoEnabled ? (
                <li>
                  <Link
                    to="/demo"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-4 py-3 text-base text-primary transition-colors hover:bg-white/10"
                  >
                    <FlaskConical className="size-4" aria-hidden="true" />
                    {t('demo.open')}
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </header>
  );
}
