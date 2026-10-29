import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 1400;

/** Counts a leading whole number up from zero once it scrolls into view; the suffix stays put. */
export function CountUp({ value }: { value: string }) {
  const match = /^(\d+)(.*)$/.exec(value);
  const target = match ? Number(match[1]) : 0;
  const suffix = match?.[2] ?? '';
  const ref = useRef<HTMLSpanElement>(null);
  const skip =
    !match ||
    typeof IntersectionObserver === 'undefined' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(skip ? target : 0);

  useEffect(() => {
    const node = ref.current;
    if (skip || !node) {
      return;
    }
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) {
        return;
      }
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / DURATION_MS);
        setShown(Math.round(target * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) {
          frame = requestAnimationFrame(tick);
        }
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [skip, target]);

  return (
    <span ref={ref} aria-label={value} className="tabular-nums">
      <span aria-hidden="true">
        {shown}
        {suffix}
      </span>
    </span>
  );
}
