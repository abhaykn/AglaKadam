import { useEffect } from 'react';

/**
 * The landing page has a good many small decorations that move for ever: twinkling stars, rising
 * dots, floating shapes, the light round the buttons. Moving drawings in SVG are redrawn by the
 * browser's main thread on every frame, and that is the thread that scrolling needs, so the page
 * stuttered. Here the decorations rest while the page is being scrolled and while their section
 * is off screen; they move again a moment after the scrolling stops.
 */
export function useScrollCalm(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.calm = '';
    let timer = 0;
    const onScroll = () => {
      if (!('scrolling' in root.dataset)) {
        root.dataset.scrolling = '';
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        delete root.dataset.scrolling;
      }, 160);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    const sections = Array.from(document.querySelectorAll<HTMLElement>('.snap-page'));
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              const section = entry.target as HTMLElement;
              if (entry.isIntersecting) {
                delete section.dataset.away;
              } else {
                section.dataset.away = '';
              }
            }
          });
    sections.forEach((section) => observer?.observe(section));

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      observer?.disconnect();
      sections.forEach((section) => {
        delete section.dataset.away;
      });
      delete root.dataset.scrolling;
      delete root.dataset.calm;
    };
  }, []);
}
