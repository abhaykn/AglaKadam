import Lenis from 'lenis';

let lenis: Lenis | null = null;

/**
 * Inertia scrolling for pages that ask for it. It is limited to a mouse or trackpad and to people
 * who have not asked for reduced motion: phones keep their own, already smooth, native scrolling.
 * Returns the function that switches it off again.
 */
export function startSmoothScroll(): () => void {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!finePointer || reducedMotion) {
    return () => undefined;
  }

  const instance = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    autoRaf: true,
  });
  lenis = instance;

  return () => {
    instance.destroy();
    if (lenis === instance) {
      lenis = null;
    }
  };
}

/** Glides to an element, through the smooth scroller when it is running. */
export function scrollToElement(target: HTMLElement): void {
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.4 });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
