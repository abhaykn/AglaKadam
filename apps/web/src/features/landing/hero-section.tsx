import { Link } from '@tanstack/react-router';
import { ArrowRight, FlaskConical, WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getEnv } from '@/lib/env';

// The video is kept in the application itself, not on another site, so that it always plays.
const HERO_POSTER_SRC = '/media/hero-poster.jpg';
// 1280 by 720 at 24 frames a second: a page that scrolls over it has far less to decode than over
// full-HD. VP9 is smaller than H.264 and is tried first; every browser can play the MP4. The file
// name carries the size because these files are cached for a year.
const HERO_VIDEO_SOURCES = [
  { src: '/media/hero-720.webm', type: 'video/webm; codecs="vp9"' },
  { src: '/media/hero-720.mp4', type: 'video/mp4' },
] as const;

const displayFont = { fontFamily: 'var(--font-display)' } as const;

/**
 * Full-screen hero: the night reading scene as background, glass navigation and a serif headline.
 * It always renders in the dark palette so text stays legible whatever theme the visitor chose.
 */
export function HeroSection() {
  const { t } = useTranslation();
  const demoEnabled = getEnv().demoWorkspaceEnabled;
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // A visitor who asked the browser to save data gets the still night sky instead of the video.
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
    true;
  const contentRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);

  // As the visitor scrolls away the content lifts and fades and the bottom corners darken. Only
  // opacity and transform change, which the browser can do on the graphics card without repainting.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const shade = shadeRef.current;
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (section.offsetHeight * 0.55)));
      const content = contentRef.current;
      if (content) {
        content.style.opacity = String(1 - progress * 0.7);
        content.style.transform = `translate3d(0, ${(-progress * 56).toFixed(1)}px, 0)`;
      }
      if (shade) {
        shade.style.opacity = progress.toFixed(3);
      }
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Respect "reduce motion": leave the video on its first frame instead of looping it. Otherwise
  // the video plays only while the hero is on screen, so scrolling the rest of the page is not
  // slowed by decoding frames nobody can see.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.pause();
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
    };
  }, []);

  const title = t('landing.hero.title');
  const accent = t('landing.hero.titleAccent');
  const lead = title.endsWith(accent) ? title.slice(0, -accent.length).trimEnd() : title;

  return (
    <section
      ref={sectionRef}
      aria-labelledby="hero-title"
      data-theme="dark"
      className="snap-page relative isolate -mt-20 flex min-h-dvh flex-col overflow-hidden bg-[hsl(201_100%_13%)] text-white"
      style={{ fontFamily: 'var(--font-hero-body)' }}
    >
      {saveData ? null : (
        <video
          ref={videoRef}
          className="absolute inset-0 z-0 h-full w-full object-cover"
          poster={HERO_POSTER_SRC}
          preload="auto"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        >
          {HERO_VIDEO_SOURCES.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      )}

      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-0 h-48 bg-gradient-to-t from-[hsl(201_100%_13%)] to-transparent"
      />

      <div
        ref={contentRef}
        className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-28 pb-28 text-center [text-shadow:0_1px_14px_rgb(0_0_0/0.5)] sm:pt-20"
      >
        <p className="animate-fade-rise mb-6 text-sm font-medium tracking-wide text-white/65">
          {t('landing.hero.eyebrow')}
        </p>
        <h1
          id="hero-title"
          className="animate-fade-rise max-w-7xl text-5xl leading-[0.95] font-normal tracking-[-0.03em] text-balance sm:text-7xl md:text-8xl md:tracking-[-2.46px]"
          style={displayFont}
        >
          {lead} <em className="text-white/60 not-italic">{accent}</em>
        </h1>
        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
          {t('landing.hero.subtitle')}
        </p>

        <div className="animate-fade-rise-delay-2 mt-12 flex flex-col items-center gap-4 sm:flex-row">
          {demoEnabled ? (
            <>
              <Link
                to="/demo"
                className="liquid-glass btn-shine btn-arrow btn-glow inline-flex cursor-pointer items-center gap-2 rounded-full bg-[hsl(201_100%_13%/0.38)]! px-10 py-5 text-base font-medium text-white transition-transform hover:scale-[1.04] active:scale-[0.98] sm:px-14"
              >
                <FlaskConical className="size-5" aria-hidden="true" />
                {t('demo.hero.cta')}
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <Link
                to="/login"
                className="liquid-glass btn-shine rounded-full bg-black/30! px-8 py-5 text-base text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                {t('landing.hero.primaryCta')}
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="liquid-glass btn-shine btn-arrow btn-glow inline-flex cursor-pointer items-center gap-2 rounded-full bg-[hsl(201_100%_13%/0.38)]! px-10 py-5 text-base font-medium text-white transition-transform hover:scale-[1.04] active:scale-[0.98] sm:px-14"
              >
                {t('landing.hero.primaryCta')}
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <a
                href="#how-it-works"
                className="liquid-glass btn-shine rounded-full bg-black/30! px-8 py-5 text-base text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                {t('landing.hero.secondaryCta')}
              </a>
            </>
          )}
        </div>

        <p className="animate-fade-rise-delay-2 mt-8 flex max-w-xl items-start justify-center gap-2 rounded-2xl bg-black/50 px-4 py-2.5 text-sm text-white/80">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t('landing.hero.note')}</span>
        </p>
      </div>
      <div
        ref={shadeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 opacity-0 [background:radial-gradient(ellipse_70%_60%_at_0%_100%,hsl(201_100%_13%/0.55),transparent),radial-gradient(ellipse_70%_60%_at_100%_100%,hsl(201_100%_13%/0.55),transparent)]"
      />
      <span
        aria-hidden="true"
        className="absolute bottom-6 left-1/2 z-10 hidden h-9 w-5 -translate-x-1/2 justify-center rounded-full border border-white/40 pt-2 sm:flex"
      >
        <span
          className="h-1.5 w-0.5 rounded-full bg-white"
          style={{ animation: 'scroll-cue 1.8s ease-in-out infinite' }}
        />
      </span>
    </section>
  );
}
