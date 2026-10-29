/** The answers of the teacher's form after a check. */

export type ReadingLevel = 'fluent' | 'hesitant' | 'needs_support';
export type EnglishLevel = 'sentences' | 'words' | 'no_response';
export type Clarity = 'clear' | 'low_voice' | 'nervous';
export type Classroom = 'normal' | 'noisy';
export type CheckTag =
  'missed_words' | 'good_pace' | 'repeated_line' | 'mixed_languages' | 'needed_prompting';

export interface CheckFormValues {
  readingLevel: ReadingLevel | null;
  englishLevel: EnglishLevel | null;
  clarity: Clarity | null;
  classroom: Classroom | null;
  tags: CheckTag[];
}

export const EMPTY_FORM: CheckFormValues = {
  readingLevel: null,
  englishLevel: null,
  clarity: null,
  classroom: null,
  tags: [],
};

/** All answers of a recorded check are given. */
export function isComplete(values: CheckFormValues): values is CheckFormValues & {
  readingLevel: ReadingLevel;
  englishLevel: EnglishLevel;
  clarity: Clarity;
  classroom: Classroom;
} {
  return (
    values.readingLevel !== null &&
    values.englishLevel !== null &&
    values.clarity !== null &&
    values.classroom !== null
  );
}

/** The answers an adapted check needs (it has no recording, so no voice or room). */
export function isAdaptedComplete(values: CheckFormValues): values is CheckFormValues & {
  readingLevel: ReadingLevel;
  englishLevel: EnglishLevel;
} {
  return values.readingLevel !== null && values.englishLevel !== null;
}

export const RECORDED_TAGS: readonly CheckTag[] = [
  'missed_words',
  'good_pace',
  'repeated_line',
  'mixed_languages',
];

export const ADAPTED_TAGS: readonly CheckTag[] = ['needed_prompting', 'mixed_languages'];
