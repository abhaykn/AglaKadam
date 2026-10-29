import {
  Apple,
  Backpack,
  Banana,
  Bed,
  Bird,
  Book,
  Bus,
  Cake,
  Car,
  Carrot,
  Cat,
  Clock,
  Cloud,
  Dog,
  Droplet,
  Egg,
  Fish,
  Flower2,
  Gift,
  Grape,
  House,
  IceCreamCone,
  Leaf,
  Milk,
  Moon,
  Mountain,
  PawPrint,
  Pencil,
  Plane,
  Rabbit,
  School,
  Shell,
  Ship,
  Squirrel,
  Star,
  Sun,
  Tent,
  TreeDeciduous,
  Umbrella,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { Picture, ReadingPart, SpeakingPart } from './item-bank';
import type { ItemLevel } from './item-levels';

const DRAWINGS: Record<Picture, { icon: LucideIcon; colour: string }> = {
  apple: { icon: Apple, colour: 'text-red-300' },
  backpack: { icon: Backpack, colour: 'text-sky-300' },
  banana: { icon: Banana, colour: 'text-yellow-300' },
  bed: { icon: Bed, colour: 'text-indigo-300' },
  bird: { icon: Bird, colour: 'text-sky-300' },
  book: { icon: Book, colour: 'text-emerald-300' },
  bus: { icon: Bus, colour: 'text-amber-300' },
  cake: { icon: Cake, colour: 'text-pink-300' },
  car: { icon: Car, colour: 'text-red-300' },
  carrot: { icon: Carrot, colour: 'text-orange-300' },
  cat: { icon: Cat, colour: 'text-stone-300' },
  clock: { icon: Clock, colour: 'text-slate-300' },
  cloud: { icon: Cloud, colour: 'text-slate-300' },
  dog: { icon: Dog, colour: 'text-amber-300' },
  droplet: { icon: Droplet, colour: 'text-blue-300' },
  egg: { icon: Egg, colour: 'text-amber-300' },
  fish: { icon: Fish, colour: 'text-cyan-300' },
  flower: { icon: Flower2, colour: 'text-pink-300' },
  gift: { icon: Gift, colour: 'text-purple-300' },
  grape: { icon: Grape, colour: 'text-purple-300' },
  house: { icon: House, colour: 'text-orange-300' },
  'ice-cream': { icon: IceCreamCone, colour: 'text-pink-300' },
  leaf: { icon: Leaf, colour: 'text-green-300' },
  milk: { icon: Milk, colour: 'text-sky-300' },
  moon: { icon: Moon, colour: 'text-indigo-300' },
  mountain: { icon: Mountain, colour: 'text-stone-300' },
  paw: { icon: PawPrint, colour: 'text-amber-300' },
  pencil: { icon: Pencil, colour: 'text-yellow-300' },
  plane: { icon: Plane, colour: 'text-sky-300' },
  rabbit: { icon: Rabbit, colour: 'text-stone-300' },
  school: { icon: School, colour: 'text-red-300' },
  shell: { icon: Shell, colour: 'text-orange-400' },
  ship: { icon: Ship, colour: 'text-blue-300' },
  squirrel: { icon: Squirrel, colour: 'text-amber-300' },
  star: { icon: Star, colour: 'text-yellow-300' },
  sun: { icon: Sun, colour: 'text-amber-300' },
  tent: { icon: Tent, colour: 'text-emerald-300' },
  tree: { icon: TreeDeciduous, colour: 'text-green-300' },
  umbrella: { icon: Umbrella, colour: 'text-violet-300' },
};

/** One of the prompt pictures, large enough to talk about across a classroom desk. */
export function PictureCard({ picture }: { picture: Picture }) {
  const { icon: Icon, colour } = DRAWINGS[picture];
  return (
    <div className="flex aspect-square items-center justify-center rounded-2xl bg-surface-sunken p-4">
      <Icon
        className={cn('size-full max-h-28 max-w-28', colour)}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </div>
  );
}

/** What the child reads, in large type, at the level the teacher has stepped down to. */
export function ReadingDisplay({ part, level }: { part: ReadingPart; level: ItemLevel }) {
  if (level === 'passage') {
    return (
      <p lang={part.language} className="text-2xl leading-relaxed font-medium text-fg sm:text-3xl">
        {part.passage}
      </p>
    );
  }
  const entries = level === 'words' ? part.words : part.letters;
  return (
    <ul
      lang={part.language}
      className={cn(
        'grid gap-3',
        level === 'words' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-4 sm:grid-cols-6',
      )}
    >
      {entries.map((entry) => (
        <li
          key={entry}
          className="rounded-2xl bg-surface-sunken px-3 py-4 text-center text-3xl font-semibold text-fg"
        >
          {entry}
        </li>
      ))}
    </ul>
  );
}

/** The English part: the pictures and the question, which the teacher reads out once. */
export function SpeakingDisplay({ part }: { part: SpeakingPart }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p lang="en" className="text-2xl font-semibold text-fg">
        {part.question}
      </p>
      <p className="text-sm text-fg-muted">{t(`pulse.speaking.instruction${part.grade}`)}</p>
      <div
        className={cn(
          'grid gap-3',
          part.pictures.length === 1
            ? 'grid-cols-1 sm:w-1/2'
            : part.pictures.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-3',
        )}
      >
        {part.pictures.map((picture) => (
          <PictureCard key={picture} picture={picture} />
        ))}
      </div>
    </div>
  );
}
