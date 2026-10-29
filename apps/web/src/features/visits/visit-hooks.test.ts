import { describe, expect, it } from 'vitest';
import { initialiseI18n } from '@/i18n';
import en from '@/i18n/locales/en.json';
import { reasonText, visitReasonFor } from './visit-hooks';

const t = initialiseI18n().getFixedT('en');

describe('why a visit was not accepted', () => {
  const reason = (code: string, message = '') => visitReasonFor({ code, message }, t);

  it('names the refusals of the visit a CRP can act on', () => {
    expect(reason('23514', 'A visit cannot take place in the future.')).toBe(
      en.visits.visit.refused.future,
    );
    expect(reason('23514', 'A visit starts on the day it took place.')).toBe(
      en.visits.visit.refused.startDay,
    );
    expect(
      reason(
        '23514',
        'new row for relation "visits" violates check constraint "visits_times_valid"',
      ),
    ).toBe(en.visits.visit.refused.times);
    expect(reason('23514', 'The teacher observed must teach at the school.')).toBe(
      en.visits.visit.refused.teacher,
    );
    expect(reason('23514', 'The agreement cannot be before the visit.')).toBe(
      en.visits.visit.refused.agreedBefore,
    );
  });

  it('speaks of the voice note, not of a child, when its upload is refused', () => {
    expect(reason('storage_403', 'new row violates row-level security policy')).toBe(
      en.visits.visit.refused.noteRefused,
    );
    expect(reason('storage_413')).toBe(en.visits.visit.refused.noteTooLarge);
    expect(reason('storage_500')).toBe(
      en.visits.visit.refused.noteUpload.replace('{{code}}', '500'),
    );
  });

  it('falls back to the general reasons', () => {
    expect(reason('network')).toBe(en.sync.reasons.network);
  });
});

describe('the reasons of the plan', () => {
  it('says a class was visited today rather than zero days ago', () => {
    expect(reasonText({ kind: 'visitedRecently', days: 0 }, t, 'en')).toBe(
      en.visits.reason.visitedToday,
    );
    expect(reasonText({ kind: 'visitedRecently', days: 1 }, t, 'en')).toBe('Visited 1 day ago');
  });
});
