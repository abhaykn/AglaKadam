import { describe, expect, it } from 'vitest';
import { initialiseI18n } from '@/i18n';
import en from '@/i18n/locales/en.json';
import { reasonFor } from './sync-reasons';

const t = initialiseI18n().getFixedT('en');

describe('why a change was not accepted', () => {
  it('names the Pulse refusals a teacher can act on', () => {
    const reason = (code: string, message = '') => reasonFor({ code, message }, t);
    expect(reason('42501', 'The family has withdrawn consent for audio checks.')).toBe(
      en.sync.reasons.consentWithdrawn,
    );
    expect(
      reason('23514', 'This child was replaced by another child before the check was made.'),
    ).toBe(en.sync.reasons.replaced);
    expect(reason('23514', 'This recording was already sent for another check.')).toBe(
      en.sync.reasons.reused,
    );
    expect(reason('storage_403', 'new row violates row-level security policy')).toBe(
      en.sync.reasons.uploadRefused,
    );
    expect(reason('storage_413')).toBe(en.sync.reasons.tooLarge);
    expect(reason('23505', 'duplicate key value violates unique constraint')).toBe(
      en.sync.reasons.duplicate,
    );
    expect(reason('42501', 'permission denied')).toBe(en.sync.reasons.permission);
  });
});
