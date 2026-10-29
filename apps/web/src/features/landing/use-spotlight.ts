import { useEffect } from 'react';

/** Feeds the pointer position to any `.spotlight` card under it, for the hover glow. */
export function useSpotlight(): void {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>('.spotlight');
      if (!card) {
        return;
      }
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);
}
