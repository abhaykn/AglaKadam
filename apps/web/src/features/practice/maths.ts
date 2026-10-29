import type { Grade } from '@/features/pulse/item-bank';

/**
 * Number practice for home, made up on the phone so that it never runs out and needs no network.
 * Each class practises what NIPUN Bharat expects of it: Class 1 counts, compares and adds and
 * subtracts within 20; Class 2 adds and subtracts within 100, compares numbers to 999 and starts
 * the tables; Class 3 works within 999,
 * with the tables to 10 and division without remainder.
 */

export type MathsKind = 'count' | 'compare' | 'next' | 'add' | 'subtract' | 'multiply' | 'divide';

export interface MathsQuestion {
  kind: MathsKind;
  /** The numbers the question shows: the two operands, the two to compare, or the sequence. */
  numbers: number[];
  answer: number;
  /** The answer among others close to it, in random order. */
  choices: number[];
}

/** A small, fast generator of numbers in [0, 1) from a seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A whole number from `low` to `high`, both included. */
function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

function pick<Value>(random: () => number, values: readonly Value[]): Value {
  return values[Math.floor(random() * values.length)] as Value;
}

function shuffle<Value>(random: () => number, values: Value[]): Value[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other] as Value, shuffled[index] as Value];
  }
  return shuffled;
}

/** The answer and three wrong answers near it that a child might give, none below `least`. */
function choicesFor(
  random: () => number,
  answer: number,
  steps: readonly number[],
  least = 0,
): number[] {
  const wrong = new Set<number>();
  for (const step of shuffle(random, [...steps, ...steps.map((value) => -value)])) {
    const value = answer + step;
    if (value >= least && value !== answer) {
      wrong.add(value);
    }
    if (wrong.size === 3) {
      break;
    }
  }
  for (let value = answer + 1; wrong.size < 3; value += 1) {
    wrong.add(value);
  }
  return shuffle(random, [answer, ...wrong]);
}

const KINDS: Record<Grade, readonly MathsKind[]> = {
  1: ['count', 'compare', 'next', 'add', 'subtract'],
  2: ['compare', 'next', 'add', 'subtract', 'multiply'],
  3: ['next', 'add', 'subtract', 'multiply', 'divide'],
};

/** One question for a class, chosen and filled in from `random`. */
export function mathsQuestion(grade: Grade, random: () => number): MathsQuestion {
  const kind = pick(random, KINDS[grade]);
  const near = grade === 1 ? [1, 2, 3] : [1, 2, 10];
  switch (kind) {
    case 'count': {
      const answer = between(random, 1, 12);
      return { kind, numbers: [answer], answer, choices: choicesFor(random, answer, [1, 2], 1) };
    }
    case 'compare': {
      const limit = grade === 1 ? 99 : 999;
      const first = between(random, 1, limit);
      let second = between(random, 1, limit);
      if (second === first) {
        second = first === limit ? first - 1 : first + 1;
      }
      const answer = Math.max(first, second);
      return { kind, numbers: [first, second], answer, choices: [first, second] };
    }
    case 'next': {
      const step = pick(random, grade === 1 ? [1] : grade === 2 ? [2, 5, 10] : [3, 4, 25, 50, 100]);
      const limit = grade === 1 ? 95 : grade === 2 ? 95 : 900;
      const start = step * between(random, 0, Math.floor((limit - 3 * step) / step));
      const numbers = [start, start + step, start + 2 * step];
      const answer = start + 3 * step;
      return {
        kind,
        numbers,
        answer,
        choices: choicesFor(random, answer, [1, step === 1 ? 2 : step]),
      };
    }
    case 'add': {
      const limit = grade === 1 ? 20 : grade === 2 ? 100 : 999;
      const answer = between(random, 2, limit);
      const first = between(random, 1, answer - 1);
      return {
        kind,
        numbers: [first, answer - first],
        answer,
        choices: choicesFor(random, answer, near),
      };
    }
    case 'subtract': {
      const limit = grade === 1 ? 20 : grade === 2 ? 100 : 999;
      const first = between(random, 2, limit);
      const second = between(random, 1, first - 1);
      const answer = first - second;
      return { kind, numbers: [first, second], answer, choices: choicesFor(random, answer, near) };
    }
    case 'multiply': {
      const table = between(random, 2, grade === 2 ? 5 : 10);
      const times = between(random, 1, 10);
      const answer = table * times;
      return {
        kind,
        numbers: [table, times],
        answer,
        choices: choicesFor(random, answer, [table, 1, 2]),
      };
    }
    case 'divide': {
      const divisor = between(random, 2, 10);
      const answer = between(random, 1, 10);
      return {
        kind,
        numbers: [divisor * answer, divisor],
        answer,
        choices: choicesFor(random, answer, [1, 2, 3], 1),
      };
    }
  }
}
