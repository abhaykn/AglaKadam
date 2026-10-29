import { describe, expect, it } from 'vitest';
import { chooseItem, hashText } from './choose-item';
import {
  measurePassage,
  passageWords,
  PASSAGE_WORDS,
  PICTURES,
  readingParts,
  speakingParts,
  type Grade,
  type ReadingLanguage,
} from './item-bank';
import { itemRecord, nextReadingLevel } from './item-levels';

const GRADES: Grade[] = [1, 2, 3];
const LANGUAGES: ReadingLanguage[] = ['hi', 'en'];
/** The format the database accepts for item and prompt codes. */
const CODE_FORMAT = /^[a-z0-9][a-z0-9-]{2,47}$/;

describe('reading passages', () => {
  it('offers twelve distinct passages for every grade and language, with distinct codes', () => {
    const codes = new Set<string>();
    for (const language of LANGUAGES) {
      for (const grade of GRADES) {
        const parts = readingParts(language, grade);
        expect(parts).toHaveLength(12);
        expect(new Set(parts.map((part) => part.passage)).size).toBe(12);
        for (const part of parts) {
          expect(part.code).toMatch(CODE_FORMAT);
          expect(part.code.startsWith(`${language}-g${String(grade)}-p`)).toBe(true);
          expect(part.language).toBe(language);
          expect(part.grade).toBe(grade);
          codes.add(part.code);
        }
      }
    }
    expect(codes.size).toBe(72);
  });

  it('keeps every passage within the length set for its grade', () => {
    for (const language of LANGUAGES) {
      for (const grade of GRADES) {
        for (const part of readingParts(language, grade)) {
          const { words } = measurePassage(part.passage);
          expect(words, part.code).toBeGreaterThanOrEqual(PASSAGE_WORDS[grade].min);
          expect(words, part.code).toBeLessThanOrEqual(PASSAGE_WORDS[grade].max);
        }
      }
    }
  });

  it('makes passages longer from one grade to the next', () => {
    for (const language of LANGUAGES) {
      const average = (grade: Grade) => {
        const parts = readingParts(language, grade);
        const total = parts.reduce((sum, part) => sum + measurePassage(part.passage).words, 0);
        return total / parts.length;
      };
      expect(average(1)).toBeLessThan(average(2));
      expect(average(2)).toBeLessThan(average(3));
    }
  });

  it('writes Hindi in Devanagari and English in Latin letters', () => {
    for (const grade of GRADES) {
      for (const part of readingParts('hi', grade)) {
        expect(part.passage, part.code).toMatch(/^[\p{scx=Devanagari}\s,?!"'-]+$/u);
        for (const text of [...part.words, ...part.letters]) {
          expect(text).toMatch(/^\p{scx=Devanagari}+$/u);
        }
      }
      for (const part of readingParts('en', grade)) {
        expect(part.passage, part.code).toMatch(/^[A-Za-z\s.,?!"'-]+$/);
        for (const text of [...part.words, ...part.letters]) {
          expect(text).toMatch(/^[a-z]+$/);
        }
      }
    }
  });

  it('gives every passage ten distinct words and twelve distinct letters to step down to', () => {
    for (const language of LANGUAGES) {
      for (const grade of GRADES) {
        for (const part of readingParts(language, grade)) {
          expect(part.words).toHaveLength(10);
          expect(new Set(part.words).size).toBe(10);
          expect(part.letters).toHaveLength(12);
          expect(new Set(part.letters).size).toBe(12);
        }
      }
    }
  });

  it('uses Hindi conjuncts in the Class 3 step-down words only', () => {
    const conjuncts = (grade: Grade) =>
      readingParts('hi', grade).some((part) =>
        part.words.some((word) => measurePassage(word).conjuncts > 0),
      );
    expect(conjuncts(1)).toBe(false);
    expect(conjuncts(2)).toBe(false);
    expect(conjuncts(3)).toBe(true);
  });
});

describe('measuring a passage', () => {
  it('counts words without punctuation, sentences and conjuncts', () => {
    expect(passageWords('Sam has a cat. It is black!')).toEqual([
      'Sam',
      'has',
      'a',
      'cat',
      'It',
      'is',
      'black',
    ]);
    const english = measurePassage('Sam has a cat. It is black!');
    expect(english.words).toBe(7);
    expect(english.sentences).toBe(2);
    expect(english.conjuncts).toBe(0);
    expect(english.averageWordLength).toBeCloseTo(19 / 7);

    const hindi = measurePassage('बच्चा स्कूल गया। वह खुश है।');
    expect(hindi.words).toBe(6);
    expect(hindi.sentences).toBe(2);
    expect(hindi.conjuncts).toBe(2);
  });

  it('treats an empty passage as having no words', () => {
    expect(measurePassage('')).toEqual({
      words: 0,
      sentences: 0,
      conjuncts: 0,
      averageWordLength: 0,
    });
  });
});

describe('English speaking prompts', () => {
  const PICTURES_PER_PROMPT: Record<Grade, number> = { 1: 2, 2: 1, 3: 3 };

  it('offers twelve prompts for every grade, with the pictures each grade needs', () => {
    const codes = new Set<string>();
    for (const grade of GRADES) {
      const parts = speakingParts(grade);
      expect(parts).toHaveLength(12);
      for (const part of parts) {
        expect(part.code).toMatch(CODE_FORMAT);
        expect(part.code.startsWith(`en-g${String(grade)}-s`)).toBe(true);
        expect(part.pictures).toHaveLength(PICTURES_PER_PROMPT[grade]);
        expect(new Set(part.pictures).size).toBe(part.pictures.length);
        for (const picture of part.pictures) {
          expect(PICTURES).toContain(picture);
        }
        expect(part.keywords.length).toBeGreaterThan(0);
        expect(part.keywords.every((word) => /^[a-z]+$/.test(word))).toBe(true);
        codes.add(part.code);
      }
      expect(new Set(parts.map((part) => part.pictures.join(','))).size).toBe(12);
    }
    expect(codes.size).toBe(36);
  });

  it('never shares a code with a reading passage', () => {
    const reading = new Set(
      LANGUAGES.flatMap((language) =>
        GRADES.flatMap((grade) => readingParts(language, grade).map((part) => part.code)),
      ),
    );
    for (const grade of GRADES) {
      for (const part of speakingParts(grade)) {
        expect(reading.has(part.code)).toBe(false);
      }
    }
  });

  it('hands out copies, so a change to one item never reaches the bank', () => {
    const [first] = speakingParts(1);
    first?.pictures.push('moon');
    expect(speakingParts(1)[0]?.pictures).toHaveLength(2);
  });
});

describe('choosing the items of a check', () => {
  const base = {
    language: 'hi' as const,
    grade: 2 as const,
    sampleId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    attempt: 1 as const,
    seen: new Set<string>(),
  };

  it('always gives a child the same items, however often the recorder is opened', () => {
    expect(chooseItem(base)).toEqual(chooseItem(base));
    const item = chooseItem(base);
    expect(item.reading.language).toBe('hi');
    expect(item.reading.grade).toBe(2);
    expect(item.speaking.grade).toBe(2);
  });

  it('skips a passage and a prompt the child has already had', () => {
    const first = chooseItem(base);
    const again = chooseItem({
      ...base,
      seen: new Set([first.reading.code, first.speaking.code]),
    });
    expect(again.reading.code).not.toBe(first.reading.code);
    expect(again.speaking.code).not.toBe(first.speaking.code);
  });

  it('gives a second attempt a different passage and prompt from the first', () => {
    const first = chooseItem(base);
    const retake = chooseItem({
      ...base,
      attempt: 2,
      previous: { reading: first.reading.code, speaking: first.speaking.code },
    });
    expect(retake.reading.code).not.toBe(first.reading.code);
    expect(retake.speaking.code).not.toBe(first.speaking.code);
  });

  it('repeats items only when the child has had them all, and never the previous ones', () => {
    const seen = new Set([
      ...readingParts('hi', 2).map((part) => part.code),
      ...speakingParts(2).map((part) => part.code),
    ]);
    const previous = { reading: 'hi-g2-p04', speaking: 'en-g2-s04' };
    const item = chooseItem({ ...base, attempt: 2, seen, previous });
    expect(item.reading.code).not.toBe(previous.reading);
    expect(item.speaking.code).not.toBe(previous.speaking);
  });

  it('spreads children over the passages and prompts', () => {
    const passages = new Set<string>();
    const prompts = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const item = chooseItem({ ...base, sampleId: `sample-${String(index)}` });
      passages.add(item.reading.code);
      prompts.add(item.speaking.code);
    }
    expect(passages.size).toBe(12);
    expect(prompts.size).toBe(12);
    expect(hashText('a')).not.toBe(hashText('b'));
  });
});

describe('the steps of a recording', () => {
  it('steps down from the passage to words and letters, and no further', () => {
    expect(nextReadingLevel('passage')).toBe('words');
    expect(nextReadingLevel('words')).toBe('letters');
    expect(nextReadingLevel('letters')).toBeNull();
    expect(nextReadingLevel('english')).toBeNull();
  });

  it('keeps exactly what was shown, and when, with the check', () => {
    const item = chooseItem({
      language: 'en',
      grade: 3,
      sampleId: 'sample-1',
      attempt: 1,
      seen: new Set(),
    });
    const record = itemRecord(
      item,
      [
        { level: 'passage', atMs: 0 },
        { level: 'words', atMs: 21_000 },
        { level: 'english', atMs: 40_000 },
      ],
      1,
    );
    expect(record).toEqual({
      reading: {
        code: item.reading.code,
        language: 'en',
        grade: 3,
        passage: item.reading.passage,
        words: item.reading.words,
        letters: item.reading.letters,
      },
      speaking: {
        code: item.speaking.code,
        grade: 3,
        pictures: item.speaking.pictures,
        keywords: item.speaking.keywords,
        // The engine takes the teacher's question out of the English part.
        question: 'Look at the pictures. Tell me about them.',
      },
      shown: [
        { level: 'passage', atMs: 0 },
        { level: 'words', atMs: 21_000 },
        { level: 'english', atMs: 40_000 },
      ],
      restarts: 1,
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});
