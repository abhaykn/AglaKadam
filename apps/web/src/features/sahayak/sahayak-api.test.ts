import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { feedbackFingerprint } from '@shared/feedback-fingerprint.ts';
import { SCENARIOS } from '@shared/rehearsal.ts';
import en from '@/i18n/locales/en.json';
import type { Visit, VisitFeedback } from '@/features/visits/visit-change';
import { FunctionCallError } from '@/lib/functions';
import {
  base64Of,
  checkBackDaysOf,
  draftRequest,
  fingerprintOf,
  namesToHide,
  sahayakError,
  SCENARIO_CODES,
  scoreIsCurrent,
  withDraft,
  type FeedbackScore,
} from './sahayak-api';

const MOMENT = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e801';

const visit: Visit = {
  id: '0f1e2d3c-4b5a-4968-8776-655443322110',
  classSectionId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  schoolId: '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9',
  crpId: '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c2',
  teacherId: '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c3',
  status: 'done',
  plannedOn: null,
  visitedOn: '2026-10-20',
  startedAt: '2026-10-20T04:00:00.000Z',
  finishedAt: null,
  lessonNote: 'Sunita Devi read page 34 with the class',
  followsVisitId: null,
  followUpResult: null,
  requestId: null,
  observations: [
    { itemCode: 'every-child-reads', position: 1, answer: 'no', note: 'Only Asha read alone' },
  ],
  moments: [
    { id: MOMENT, tagCode: 'chorus-only', atSeconds: 400, note: 'Ravi and Asha Kumari silent' },
  ],
  rechecks: [],
  feedback: null,
};

describe('a draft request', () => {
  it('replaces the names of the class and the teacher everywhere before sending', () => {
    const request = draftRequest({
      visit,
      language: 'en',
      grade: 2,
      signal: { pulseChecked: 18, needsSupport: 7, hesitant: 6, fluent: 5, englishNoResponse: 4 },
      earlier: null,
      transcript: 'Asha Kumari tried hard, Sunita ji smiled.',
      names: namesToHide(['Asha Kumari', 'Ravi Kumar'], 'Sunita Devi'),
    });
    const sent = JSON.stringify(request);
    expect(sent).not.toMatch(/Asha|Ravi|Sunita/);
    expect(request.visit.moments[0]).toEqual({
      id: MOMENT,
      tag: 'Chorus only',
      tone: 'concern',
      minute: 6,
      note: '[child] and [child] silent',
    });
    expect(request.visit.lesson).toBe('[teacher] read page 34 with the class');
    expect(request.visit.transcript).toBe('[child] tried hard, [teacher] ji smiled.');
    expect(request.visit.pulse).toMatchObject({ checked: 18, needs_support: 7 });
    expect(request.visit.practices.length).toBeGreaterThan(10);
  });

  it('leaves out a Pulse month without checks and an empty transcript', () => {
    const request = draftRequest({
      visit,
      language: 'hi',
      grade: null,
      signal: { pulseChecked: 0, needsSupport: 0, hesitant: 0, fluent: 0, englishNoResponse: 0 },
      earlier: { practiceCode: 'paired-reading', result: 'partly' },
      transcript: '   ',
      names: [],
    });
    expect(request.visit.pulse).toBeNull();
    expect(request.visit.transcript).toBeNull();
    expect(request.visit.follow_up).toEqual({
      practice: expect.any(String) as string,
      result: 'partly',
    });
  });
});

describe('taking in a draft', () => {
  const feedback: VisitFeedback = {
    strength: '',
    evidence: [],
    practiceCode: null,
    changeNote: '',
    technique: '',
    demoGiven: true,
    planNote: '',
    checkBackOn: '2026-11-03',
    language: 'hi',
    agreedAt: '2026-10-20T06:00:00.000Z',
  };

  it('fills the form, keeps the demonstration and what the draft leaves empty, and asks for agreement again', () => {
    const strengthMoment = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e802';
    const observed: Visit = {
      ...visit,
      moments: [
        ...visit.moments,
        { id: strengthMoment, tagCode: 'effort-praised', atSeconds: 700, note: 'Praised a try' },
      ],
    };
    const next = withDraft(
      { ...feedback, planNote: 'My own plan' },
      {
        strength: 'S',
        // A concern and an item not seen cannot back a strength; the form could not show them.
        evidence: [{ moment: MOMENT }, { item: 'every-child-reads' }, { moment: strengthMoment }],
        practiceCode: 'paired-reading',
        changeNote: 'C',
        technique: 'T',
        planNote: '',
        checkBackDays: 90,
      },
      observed,
      '2026-10-20',
      { min: 3, max: 42 },
    );
    expect(next).toEqual({
      ...feedback,
      strength: 'S',
      evidence: [{ moment: strengthMoment }],
      practiceCode: 'paired-reading',
      changeNote: 'C',
      technique: 'T',
      planNote: 'My own plan',
      checkBackOn: '2026-12-01',
      agreedAt: null,
    });
  });
});

describe('the check-back day of a draft', () => {
  it('stays within the days the database accepts, as the card shows it', () => {
    const draft = {
      strength: '',
      evidence: [],
      practiceCode: 'paired-reading',
      changeNote: '',
      technique: '',
      planNote: '',
    };
    const range = { min: 3, max: 42 };
    expect(checkBackDaysOf({ ...draft, checkBackDays: 1 }, range)).toBe(3);
    expect(checkBackDaysOf({ ...draft, checkBackDays: 14 }, range)).toBe(14);
    expect(checkBackDaysOf({ ...draft, checkBackDays: 90 }, range)).toBe(42);
  });
});

describe('scores and messages', () => {
  it('counts a score current only for the feedback as it stands, as the function fingerprints it', async () => {
    const agreed: VisitFeedback = {
      strength: ' Asha read well. ',
      evidence: [{ item: 'b-item' }, { moment: MOMENT }],
      practiceCode: 'paired-reading',
      changeNote: '',
      technique: 'Show it',
      demoGiven: false,
      planNote: '',
      checkBackOn: '2026-11-03',
      language: 'hi',
      agreedAt: '2026-10-20T06:00:00.000Z',
    };
    // The function reads empty parts as null and evidence in its stored order.
    const server = await feedbackFingerprint({
      strength: 'Asha read well.',
      evidence: [`moment:${MOMENT}`, 'item:b-item'],
      practiceCode: 'paired-reading',
      changeNote: null,
      technique: 'Show it',
      demoGiven: false,
      planNote: null,
      checkBackOn: '2026-11-03',
    });
    const score = { feedbackFingerprint: server } as FeedbackScore;
    expect(scoreIsCurrent(score, await fingerprintOf(agreed))).toBe(true);
    expect(scoreIsCurrent(score, await fingerprintOf({ ...agreed, planNote: 'Changed' }))).toBe(
      false,
    );
    expect(scoreIsCurrent(score, null)).toBe(false);
  });

  it('explains each refusal of the function', () => {
    const t = ((key: string) => key) as unknown as TFunction;
    expect(sahayakError(new FunctionCallError('quota_exceeded', 429), t)).toBe(
      'sahayak.errors.quota',
    );
    expect(sahayakError(new FunctionCallError('not_configured', 503), t)).toBe(
      'sahayak.errors.notConfigured',
    );
    expect(sahayakError(new Error('x'), t)).toBe('sahayak.errors.other');
    expect(en.sahayak.errors.quota).toBeTruthy();
  });

  it('names the same simulated teachers as the function plays', () => {
    expect([...SCENARIO_CODES].sort()).toEqual(SCENARIOS.map((scenario) => scenario.code).sort());
    for (const code of SCENARIO_CODES) {
      expect(en.sahayak.rehearsal.scenarios[code].opening).toBeTruthy();
    }
  });

  it('encodes a picture without its data URL prefix', async () => {
    expect(await base64Of(new Blob([new Uint8Array([104, 105])]))).toBe('aGk=');
  });
});
