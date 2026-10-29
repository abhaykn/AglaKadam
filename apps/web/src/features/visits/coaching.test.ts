import { describe, expect, it } from 'vitest';
import {
  calibration,
  chooseRechecks,
  feedbackTips,
  recheckGapIsLarge,
  suggestFocusItems,
  suggestPractices,
  type RecheckCandidate,
} from './coaching';
import { FOCUS_ITEMS_PER_VISIT } from './observation-bank';

describe('focus items for a visit', () => {
  it('starts with the item of the step being followed up, then the largest gaps', () => {
    const items = suggestFocusItems(
      { pulseChecked: 10, needsSupport: 4, englishNoResponse: 5 },
      'picture-talk',
    );
    expect(items).toEqual([
      'english-own-sentences',
      'sounds-before-letters',
      'bottom-group-turns',
      'every-child-reads',
      'todays-textbook-page',
    ]);
    expect(items).toHaveLength(FOCUS_ITEMS_PER_VISIT);
  });

  it('falls back to the core items of a reading lesson', () => {
    expect(suggestFocusItems(null)).toEqual([
      'every-child-reads',
      'todays-textbook-page',
      'reads-for-meaning',
      'children-talk-more',
      'checks-understanding',
    ]);
    expect(suggestFocusItems({ pulseChecked: 10, needsSupport: 1, englishNoResponse: 0 })).toEqual(
      suggestFocusItems(null),
    );
  });
});

describe('practices to agree on', () => {
  it('comes from the items seen not to happen first', () => {
    const practices = suggestPractices([
      { itemCode: 'every-child-reads', answer: 'yes' },
      { itemCode: 'english-own-sentences', answer: 'no' },
    ]);
    expect(practices.map((entry) => entry.code)).toEqual(['sentence-frames', 'picture-talk']);
  });

  it('follows the focus items before the visit', () => {
    const practices = suggestPractices(
      [
        { itemCode: 'sounds-before-letters', answer: null },
        { itemCode: 'every-child-reads', answer: null },
      ],
      3,
    );
    expect(practices.map((entry) => entry.code)).toEqual([
      'sound-blending',
      'letter-sound-games',
      'paired-reading',
    ]);
  });
});

describe('checking the feedback', () => {
  const draft = {
    strength: 'Every child read a line alone.',
    evidenceCount: 1,
    practiceCode: 'paired-reading',
    changeNote: '',
    technique: 'Pair a stronger reader with a weaker one for ten minutes every day.',
    demoGiven: true,
    checkBackOn: '2026-11-04',
  };

  it('finds an actionable draft complete', () => {
    expect(feedbackTips(draft, '2026-10-21').every((tip) => tip.met)).toBe(true);
  });

  it('points out what is missing', () => {
    const tips = feedbackTips(
      {
        ...draft,
        evidenceCount: 0,
        practiceCode: null,
        technique: 'Read more.',
        demoGiven: false,
        checkBackOn: '2026-11-30',
      },
      '2026-10-21',
    );
    expect(tips.filter((tip) => !tip.met).map((tip) => tip.key)).toEqual([
      'evidence',
      'oneStep',
      'specific',
      'demo',
      'soon',
    ]);
  });
});

describe('children to hear again', () => {
  const candidate = (
    checkId: string,
    teacherReading: RecheckCandidate['teacherReading'],
    machineReading: RecheckCandidate['machineReading'],
    reviewed = false,
  ): RecheckCandidate => ({
    checkId,
    studentId: `student-${checkId}`,
    teacherReading,
    machineReading,
    reviewed,
  });

  it('prefers children the teacher rated higher than the engine heard', () => {
    const chosen = chooseRechecks(
      [
        candidate('a', 'hesitant', 'hesitant'),
        candidate('b', 'fluent', 'needs_support'),
        candidate('c', 'needs_support', 'hesitant'),
        candidate('d', 'fluent', null),
        candidate('e', 'fluent', 'hesitant', true),
      ],
      'visit-1',
    );
    expect(chosen.map((entry) => entry.checkId)).toEqual(['b', 'c']);
  });

  it('breaks ties the same way for the same visit, and differently for another', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidate(id, 'fluent', null));
    const first = chooseRechecks(candidates, 'visit-1');
    expect(chooseRechecks([...candidates].reverse(), 'visit-1')).toEqual(first);
    const others = ['visit-2', 'visit-3', 'visit-4', 'visit-5'].map((visit) =>
      chooseRechecks(candidates, visit).map((entry) => entry.checkId),
    );
    expect(others.some((ids) => ids.join() !== first.map((entry) => entry.checkId).join())).toBe(
      true,
    );
  });

  it('calls a gap of two levels large', () => {
    expect(recheckGapIsLarge('fluent', 'needs_support')).toBe(true);
    expect(recheckGapIsLarge('fluent', 'hesitant')).toBe(false);
  });
});

describe('calibration with a teacher', () => {
  it('prompts a conversation only after enough comparisons with low agreement', () => {
    expect(calibration([{ teacher: 'fluent', crp: 'hesitant' }]).prompt).toBe(false);
    expect(
      calibration([
        { teacher: 'fluent', crp: 'hesitant' },
        { teacher: 'fluent', crp: 'needs_support' },
        { teacher: 'hesitant', crp: 'hesitant' },
        { teacher: 'fluent', crp: 'hesitant' },
      ]),
    ).toEqual({ compared: 4, agreed: 1, prompt: true });
    expect(
      calibration([
        { teacher: 'fluent', crp: 'fluent' },
        { teacher: 'hesitant', crp: 'hesitant' },
        { teacher: 'fluent', crp: 'fluent' },
        { teacher: 'fluent', crp: 'hesitant' },
      ]).prompt,
    ).toBe(false);
  });
});
