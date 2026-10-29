import { Link } from '@tanstack/react-router';
import { ArrowRight, FlaskConical, WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getEnv } from '@/lib/env';

// The video is kept in the application itself, not on another site, so that it always plays.
const HERO_POSTER_SRC = '/media/hero-poster.jpg';
// VP9 is about half the size of H.264 and is tried first; every browser can play the MP4.
const HERO_VIDEO_SOURCES = [
  { src: '/media/hero.webm', type: 'video/webm; codecs="vp9"' },
  { src: '/media/hero.mp4', type: 'video/mp4' },
] as const;

/**
 * Progressive blur under the two bottom corners: a wide, gentle layer and a tighter, stronger one,
 * so the softening deepens towards the corner instead of starting at a visible edge. Each layer
 * is `[blur in px, how far the mask reaches, tint]`.
 */
const cornerLayers = [
  { blur: 6, reach: 1, tint: 'hsl(201 100% 13% / 0.12)' },
  { blur: 16, reach: 0.62, tint: 'hsl(201 100% 13% / 0.3)' },
] as const;

function cornerMask(progress: number, reach: number): string {
  const x = (progress * reach * 78 + 0.1).toFixed(2);
  const y = (progress * reach * 92 + 0.1).toFixed(2);
  const stops = '#000 0%, rgb(0 0 0 / 0.65) 30%, rgb(0 0 0 / 0.25) 62%, transparent 100%';
  return ['0%', '100%']
    .map((at) => `radial-gradient(ellipse ${x}% ${y}% at ${at} 100%, ${stops})`)
    .join(', ');
}

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

  // As the visitor scrolls away, both bottom corners blur and darken, spreading inwards.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const layers = Array.from(section.querySelectorAll<HTMLElement>('[data-corner]'));
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (section.offsetHeight * 0.55)));
      const content = contentRef.current;
      if (content) {
        content.style.opacity = String(1 - progress * 0.7);
        content.style.transform = `translate3d(0, ${(-progress * 56).toFixed(1)}px, 0)`;
      }
      const video = videoRef.current;
      if (video) {
        video.style.transform = `scale(${(1 + progress * 0.12).toFixed(3)})`;
      }
      layers.forEach((layer, index) => {
        const mask = cornerMask(progress, cornerLayers[index]?.reach ?? 1);
        layer.style.maskImage = mask;
        layer.style.setProperty('-webkit-mask-image', mask);
        layer.style.opacity = progress > 0.005 ? '1' : '0';
      });
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

  // Respect "reduce motion": leave the video on its first frame instead of looping it.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      videoRef.current?.pause();
    }
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
          className="absolute inset-0 z-0 h-full w-full object-cover will-change-transform"
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
                className="liquid-glass btn-shine btn-arrow btn-glow inline-flex cursor-pointer items-center gap-2 rounded-full bg-[hsl(201_100%_13%/0.38)]! px-10 py-5 text-base font-medium text-white backdrop-blur-md! transition-transform hover:scale-[1.04] active:scale-[0.98] sm:px-14"
              >
                <FlaskConical className="size-5" aria-hidden="true" />
                {t('demo.hero.cta')}
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <Link
                to="/login"
                className="liquid-glass btn-shine rounded-full bg-black/30! px-8 py-5 text-base text-white backdrop-blur-md! transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                {t('landing.hero.primaryCta')}
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="liquid-glass btn-shine btn-arrow btn-glow inline-flex cursor-pointer items-center gap-2 rounded-full bg-[hsl(201_100%_13%/0.38)]! px-10 py-5 text-base font-medium text-white backdrop-blur-md! transition-transform hover:scale-[1.04] active:scale-[0.98] sm:px-14"
              >
                {t('landing.hero.primaryCta')}
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <a
                href="#how-it-works"
                className="liquid-glass btn-shine rounded-full bg-black/30! px-8 py-5 text-base text-white backdrop-blur-md! transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                {t('landing.hero.secondaryCta')}
              </a>
            </>
          )}
        </div>

        <p className="animate-fade-rise-delay-2 mt-8 flex max-w-xl items-start justify-center gap-2 rounded-2xl bg-black/35 px-4 py-2.5 text-sm text-white/80 backdrop-blur-md">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t('landing.hero.note')}</span>
        </p>
      </div>
      {cornerLayers.map((layer) => (
        <div
          key={layer.blur}
          data-corner
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            backdropFilter: `blur(${layer.blur}px)`,
            WebkitBackdropFilter: `blur(${layer.blur}px)`,
            background: layer.tint,
            opacity: 0,
          }}
        />
      ))}
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
