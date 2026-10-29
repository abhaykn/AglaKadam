import type { PulseItem } from './item-bank';

/**
 * What the screen shows during a recording, in order: the passage, then (when the child cannot read
 * it) words and letters, and finally the English pictures.
 */
export type ItemLevel = 'passage' | 'words' | 'letters' | 'english';

/** The reading part ends here at the latest, so that the English part always gets its turn. */
export const READING_LIMIT_MS = 40_000;

const READING_LEVELS: readonly ItemLevel[] = ['passage', 'words', 'letters'];

/** The easier reading level after `level`, or null when there is none. */
export function nextReadingLevel(level: ItemLevel): ItemLevel | null {
  const index = READING_LEVELS.indexOf(level);
  return index === -1 ? null : (READING_LEVELS[index + 1] ?? null);
}

export interface ShownStep {
  level: ItemLevel;
  /** Milliseconds into the recording when the screen changed to this level. */
  atMs: number;
}

/**
 * The items as stored with the check: exactly what was shown, when the screen changed (which also
 * tells the scoring step where the reading ends and the English begins), and how often a recording
 * of this child was started and abandoned before.
 */
export function itemRecord(item: PulseItem, shown: readonly ShownStep[], restarts: number) {
  return {
    reading: {
      code: item.reading.code,
      language: item.reading.language,
      grade: item.reading.grade,
      passage: item.reading.passage,
      words: [...item.reading.words],
      letters: [...item.reading.letters],
    },
    speaking: {
      code: item.speaking.code,
      grade: item.speaking.grade,
      pictures: [...item.speaking.pictures],
      keywords: [...item.speaking.keywords],
      question: item.speaking.question,
    },
    shown: shown.map((step) => ({ level: step.level, atMs: step.atMs })),
    restarts,
  };
}
