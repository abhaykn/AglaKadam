import {
  readingParts,
  speakingParts,
  type Grade,
  type PulseItem,
  type ReadingLanguage,
} from './item-bank';

/**
 * Which passage and which English prompt a child is given. The choice depends only on the drawn
 * child and the attempt, never on when or how often the recorder is opened: cancelling and starting
 * again shows the same items, so a teacher cannot keep starting over until easy ones come up. Items
 * the child has already had are skipped.
 */

/** 32-bit FNV-1a hash of a text, for spreading choices evenly. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface ItemChoice {
  language: ReadingLanguage;
  grade: Grade;
  sampleId: string;
  attempt: 1 | 2;
  /** Codes of the passages and prompts the child has already been given. */
  seen: ReadonlySet<string>;
  /** The items of the first attempt, which a second attempt must not repeat. */
  previous?: { reading: string | null; speaking: string | null } | undefined;
}

function pick<Item extends { code: string }>(
  items: readonly Item[],
  key: string,
  seen: ReadonlySet<string>,
  previous: string | null | undefined,
): Item {
  const fresh = items.filter((item) => item.code !== previous && !seen.has(item.code));
  // A child who has had every item (after years of checks) gets one again; the server notes it.
  const pool = fresh.length > 0 ? fresh : items.filter((item) => item.code !== previous);
  const chosen = pool[hashText(key) % pool.length] ?? items[0];
  if (!chosen) {
    throw new Error('There are no Pulse items for this grade.');
  }
  return chosen;
}

export function chooseItem(choice: ItemChoice): PulseItem {
  const key = `${choice.sampleId}:${String(choice.attempt)}`;
  return {
    reading: pick(
      readingParts(choice.language, choice.grade),
      `${key}:reading`,
      choice.seen,
      choice.previous?.reading,
    ),
    speaking: pick(
      speakingParts(choice.grade),
      `${key}:speaking`,
      choice.seen,
      choice.previous?.speaking,
    ),
  };
}
