import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/features/attendance/dates';
import type { OutboxError } from '@/features/offline/device-store';
import { reasonFor } from '@/features/offline/sync-reasons';
import { useLocalisedName } from '@/lib/use-localised-name';
import { focusItem, textIn } from './observation-bank';
import type { Reason } from './plan';
import { schoolsOverviewQuery } from './visit-api';

/** The localised name of a school of the signed-in person, by id. */
export function useSchoolName(): (schoolId: string) => string {
  const localise = useLocalisedName();
  const overview = useQuery(schoolsOverviewQuery());
  return useCallback(
    (schoolId: string) => {
      const school = overview.data?.find((entry) => entry.school_id === schoolId);
      return school ? localise(school) : '';
    },
    [overview.data, localise],
  );
}

export function reasonText(reason: Reason, t: TFunction, language: string): string {
  switch (reason.kind) {
    case 'checkBack':
      return t(reason.overdue ? 'visits.reason.checkBackOverdue' : 'visits.reason.checkBack', {
        date: formatDay(reason.on, language),
      });
    case 'readingGap':
      return t('visits.reason.readingGap', {
        count: reason.needsSupport,
        checked: reason.checked,
      });
    case 'englishGap':
      return t('visits.reason.englishGap', {
        count: reason.noResponse,
        checked: reason.checked,
      });
    case 'request': {
      const topic: string = t(`visits.topic.${reason.topic}`, { defaultValue: reason.topic });
      return t('visits.reason.request', { topic });
    }
    case 'notVisited':
      return reason.days === null
        ? t('visits.reason.neverVisited')
        : t('visits.reason.notVisited', { count: reason.days });
    case 'taskDue':
      return t('visits.reason.taskDue', { count: reason.count });
    case 'marksCheck':
      return t('visits.reason.marksCheck', { count: reason.count });
    case 'visitedRecently':
      return reason.days === 0
        ? t('visits.reason.visitedToday')
        : t('visits.reason.visitedRecently', { count: reason.days });
  }
}

/** The database's reasons for refusing a visit, by the words of its message. */
const VISIT_REFUSALS = [
  [/cannot take place in the future/i, 'future'],
  [/older than 14 days/i, 'tooOld'],
  [/starts on the day it took place/i, 'startDay'],
  [/can only be moved earlier/i, 'movedLater'],
  [/visits_times_valid/i, 'times'],
  [/check-back falls between/i, 'checkBack'],
  [/agreement cannot be before/i, 'agreedBefore'],
  [/teacher observed must teach/i, 'teacher'],
] as const;

/**
 * Why a save of a visit was not accepted, in words the CRP can act on. Storage errors concern the
 * voice note, which is uploaded after the visit itself is saved.
 */
export function visitReasonFor(error: OutboxError, t: TFunction): string {
  for (const [pattern, key] of VISIT_REFUSALS) {
    if (pattern.test(error.message)) {
      return t(`visits.visit.refused.${key}`);
    }
  }
  if (error.code === 'storage_413') {
    return t('visits.visit.refused.noteTooLarge');
  }
  if (error.code === 'storage_400' || error.code === 'storage_403') {
    return t('visits.visit.refused.noteRefused');
  }
  if (error.code.startsWith('storage_')) {
    return t('visits.visit.refused.noteUpload', { code: error.code.slice('storage_'.length) });
  }
  return reasonFor(error, t);
}

/** The text of a focus item, or its code when it is no longer in the bank. */
export function useFocusText(): (code: string) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (code: string) => {
      const item = focusItem(code);
      return item ? textIn(item.text, i18n.language) : code;
    },
    [i18n.language],
  );
}
