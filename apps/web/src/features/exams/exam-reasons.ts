import type { TFunction } from 'i18next';
import type { OutboxError } from '@/features/offline/device-store';
import { reasonFor } from '@/features/offline/sync-reasons';
import { PAPER_MISSING } from './exam-change';

/** The database's reasons for refusing an exam or its marks, by the words of its message. */
const EXAM_REFUSALS = [
  [/changed for 60 days after the paper/i, 'closed'],
  [/from the day of the paper/i, 'notYet'],
  [/missing, out of range, or not of the paper/i, 'invalid'],
  [/entered by the school's teachers/i, 'teachersOnly'],
  [/with marks cannot be removed/i, 'hasMarks'],
  [/within the dates of its exam/i, 'dates'],
  [/within its academic session/i, 'session'],
  [/at most 60 days after it began/i, 'tooOld'],
  [/outside your school or cluster/i, 'notAuthor'],
  [/keeps its day/i, 'future'],
  [/keeps its exam, class and subject|A child is listed once/i, 'invalid'],
  [/maximum cannot be lower than a mark/i, 'maximum'],
] as const;

/** Why an exam or its marks were not accepted, in words a teacher or CRP can act on. */
export function examReasonFor(error: OutboxError, t: TFunction): string {
  if (error.code === PAPER_MISSING) {
    return t('exams.refused.paperMissing');
  }
  for (const [pattern, key] of EXAM_REFUSALS) {
    if (pattern.test(error.message)) {
      return t(`exams.refused.${key}`);
    }
  }
  return reasonFor(error, t);
}
