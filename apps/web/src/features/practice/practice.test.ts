import { describe, expect, it } from 'vitest';
import { passageWords, readingParts, speakingParts, type Grade } from '@/features/pulse/item-bank';
import { mathsQuestion, seededRandom } from './maths';
import {
  allPracticeWords,
  PRACTICE_LETTERS,
  practiceStories,
  practiceWords,
  practiceGrade,
} from './practice-bank';
import { summarisePractice, withStar } from './progress';
import { pickVoice } from './speech';

const GRADES: Grade[] = [1, 2, 3];
const LANGUAGES = ['hi', 'en'] as const;

function sentences(text: string): string[] {
  return text
    .split(/[।.?!]/)
    .map((sentence) => sentence.trim().replace(/\s+/g, ' '))
    .filter((sentence) => sentence.length > 0);
}

describe('the practice content', () => {
  it('never repeats a sentence, a word to read or a spoken keyword of the Pulse checks', () => {
    for (const language of LANGUAGES) {
      const checked = GRADES.flatMap((grade) => readingParts(language, grade));
      const checkSentences = new Set(checked.flatMap((part) => sentences(part.passage)));
      const checkWords = new Set([
        ...checked.flatMap((part) => part.words),
        // What the spoken English part listens for.
        ...GRADES.flatMap((grade) => speakingParts(grade).flatMap((part) => part.keywords)),
      ]);
      for (const grade of GRADES) {
        for (const story of practiceStories(language, grade)) {
          for (const sentence of sentences(story.text)) {
            expect(checkSentences.has(sentence), sentence).toBe(false);
          }
        }
      }
      for (const word of allPracticeWords(language)) {
        expect(checkWords.has(word), word).toBe(false);
      }
    }
  });

  it('gives every class stories of its length, each with three different answers', () => {
    const lengths: Record<Grade, [number, number]> = { 1: [15, 32], 2: [35, 60], 3: [50, 80] };
    for (const language of LANGUAGES) {
      for (const grade of GRADES) {
        const stories = practiceStories(language, grade);
        expect(stories.length).toBeGreaterThanOrEqual(6);
        expect(new Set(stories.map((story) => story.code)).size).toBe(stories.length);
        for (const story of stories) {
          const words = passageWords(story.text).length;
          const [low, high] = lengths[grade];
          expect(words, story.code).toBeGreaterThanOrEqual(low);
          expect(words, story.code).toBeLessThanOrEqual(high);
          expect(new Set(story.choices).size).toBe(3);
          expect(story.question.trim()).not.toBe('');
        }
      }
    }
  });

  it('has distinct words for each class and the whole alphabet', () => {
    for (const language of LANGUAGES) {
      for (const grade of GRADES) {
        const words = practiceWords(language, grade);
        expect(new Set(words).size).toBe(words.length);
        expect(words.length).toBeGreaterThanOrEqual(25);
      }
    }
    expect(PRACTICE_LETTERS.en).toHaveLength(26);
    expect(PRACTICE_LETTERS.hi).toContain('ह');
  });

  it('practises Class 3 for older children', () => {
    expect(practiceGrade(1)).toBe(1);
    expect(practiceGrade(2)).toBe(2);
    expect(practiceGrade(5)).toBe(3);
    expect(practiceGrade(null)).toBe(3);
  });
});

describe('number questions', () => {
  it('always hold the right answer among distinct choices within the class limits', () => {
    const limits: Record<Grade, number> = { 1: 99, 2: 999, 3: 999 };
    for (const grade of GRADES) {
      const random = seededRandom(grade * 7919);
      for (let round = 0; round < 2000; round += 1) {
        const question = mathsQuestion(grade, random);
        const [first = 0, second = 0, third = 0] = question.numbers;
        const expected = {
          count: first,
          compare: Math.max(first, second),
          next: third + (third - second),
          add: first + second,
          subtract: first - second,
          multiply: first * second,
          divide: first / second,
        }[question.kind];
        expect(question.answer).toBe(expected);
        expect(Number.isInteger(question.answer)).toBe(true);
        expect(question.choices).toContain(question.answer);
        expect(new Set(question.choices).size).toBe(question.choices.length);
        expect(question.choices.length).toBe(question.kind === 'compare' ? 2 : 4);
        expect(Math.min(...question.choices)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...question.numbers, question.answer)).toBeLessThanOrEqual(limits[grade]);
        if (question.kind === 'count' || question.kind === 'divide') {
          expect(Math.min(...question.choices)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('keeps Class 1 within 20 for adding and taking away', () => {
    const random = seededRandom(42);
    for (let round = 0; round < 500; round += 1) {
      const question = mathsQuestion(1, random);
      if (question.kind === 'add' || question.kind === 'subtract') {
        expect(Math.max(...question.numbers, question.answer)).toBeLessThanOrEqual(20);
      }
      expect(['multiply', 'divide']).not.toContain(question.kind);
    }
  });
});

describe('reading aloud', () => {
  const voices = [
    { lang: 'en-US', localService: true },
    { lang: 'hi_IN', localService: false },
    { lang: 'en-IN', localService: false },
    { lang: 'en-IN', localService: true },
  ];

  it('prefers an Indian voice on the phone, and offers none for a missing language', () => {
    expect(pickVoice(voices, 'en')).toBe(3);
    expect(pickVoice(voices, 'hi')).toBe(1);
    expect(pickVoice([{ lang: 'en-GB', localService: true }], 'hi')).toBeNull();
    expect(pickVoice([{ lang: 'en-AU', localService: true }], 'en')).toBe(0);
  });
});

describe('practice stars', () => {
  it("counts today's stars, the days of the week and the run of days", () => {
    let days = withStar({}, '2026-10-19');
    days = withStar(days, '2026-10-20');
    days = withStar(days, '2026-10-20');
    expect(summarisePractice(days, '2026-10-20')).toEqual({ today: 2, daysThisWeek: 2, run: 2 });
    // Before practising today, yesterday's run still counts.
    expect(summarisePractice(days, '2026-10-21')).toEqual({ today: 0, daysThisWeek: 2, run: 2 });
    expect(summarisePractice(days, '2026-10-23').run).toBe(0);
  });

  it('keeps only the last 60 days', () => {
    const days = withStar({ '2026-07-01': 3, '2026-10-01': 1 }, '2026-10-20');
    expect(Object.keys(days).sort()).toEqual(['2026-10-01', '2026-10-20']);
  });
});
