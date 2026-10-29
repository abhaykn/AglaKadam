import {
  Apple,
  Atom,
  Backpack,
  BookMarked,
  BookOpen,
  Brain,
  Calculator,
  FlaskConical,
  Globe,
  GraduationCap,
  Languages,
  Library,
  Lightbulb,
  Medal,
  Microscope,
  Music,
  NotebookPen,
  Palette,
  Pencil,
  PencilRuler,
  Presentation,
  Puzzle,
  School,
  Shapes,
  Telescope,
  Trophy,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Line-art school things scattered across the page. The order matters: the first ten are the ones
 * a phone keeps, so they are spread over the whole screen on their own.
 */
const doodles: readonly { icon: LucideIcon; left: number; top: number }[] = [
  { icon: BookOpen, left: 6, top: 9 },
  { icon: Backpack, left: 88, top: 14 },
  { icon: GraduationCap, left: 47, top: 30 },
  { icon: Pencil, left: 10, top: 48 },
  { icon: Presentation, left: 82, top: 52 },
  { icon: Library, left: 30, top: 70 },
  { icon: Lightbulb, left: 92, top: 82 },
  { icon: Apple, left: 8, top: 90 },
  { icon: Globe, left: 62, top: 90 },
  { icon: NotebookPen, left: 66, top: 8 },
  { icon: School, left: 26, top: 16 },
  { icon: Calculator, left: 95, top: 34 },
  { icon: Atom, left: 38, top: 52 },
  { icon: PencilRuler, left: 70, top: 68 },
  { icon: BookMarked, left: 3, top: 28 },
  { icon: FlaskConical, left: 54, top: 12 },
  { icon: Trophy, left: 16, top: 66 },
  { icon: Palette, left: 78, top: 32 },
  { icon: Microscope, left: 44, top: 84 },
  { icon: Music, left: 20, top: 40 },
  { icon: Puzzle, left: 58, top: 46 },
  { icon: Telescope, left: 85, top: 92 },
  { icon: Brain, left: 34, top: 4 },
  { icon: Languages, left: 74, top: 20 },
  { icon: Shapes, left: 50, top: 70 },
  { icon: Medal, left: 14, top: 80 },
];

/** Education-themed decoration for the night pages; purely visual and never interactive. */
export function EducationBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {doodles.map(({ icon: Icon, left, top }, index) => (
        <span
          key={index}
          className={`absolute text-primary/[0.13] ${index < 10 ? '' : 'hidden sm:block'}`}
          style={
            {
              left: `${left}%`,
              top: `${top}%`,
              '--r': `${((index * 37) % 50) - 25}deg`,
              animation: `float-slow ${14 + (index % 7) * 2}s ease-in-out ${-(index % 9)}s infinite`,
            } as CSSProperties
          }
        >
          <Icon
            className={index % 3 === 0 ? 'size-8 sm:size-11' : 'size-6 sm:size-8'}
            strokeWidth={1.25}
          />
        </span>
      ))}
    </div>
  );
}
