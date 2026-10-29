import { describe, expect, it, vi } from 'vitest';
import {
  claudeModel,
  CompletionError,
  failureFor,
  groqModel,
  parseObject,
  type CompletionRequest,
  type Fetcher,
  type LanguageModel,
} from '../../../supabase/functions/_shared/llm.ts';
import { feedbackFingerprint } from '../../../supabase/functions/_shared/feedback-fingerprint.ts';
import { redactNames } from '../../../supabase/functions/_shared/redact.ts';
import type {
  AgreedFeedback,
  FeedbackScore,
  SahayakServices,
} from '../../../supabase/functions/_shared/services.ts';
import {
  CLAUDE_PER_PERSON,
  clip,
  countedParts,
  DAILY_LIMITS,
  DEMO_DAILY_LIMITS,
  DEMO_PROJECT_LIMITS,
  handleSahayak,
  PROJECT_ID,
  type SahayakModels,
} from '../../../supabase/functions/sahayak/handler.ts';
import { SCENARIOS } from '../../../supabase/functions/sahayak/prompts.ts';
import { callerWith } from './support/fake-services.ts';

const TODAY = '2026-10-22';
const VISIT = '0f1e2d3c-4b5a-4968-8776-655443322110';
const MOMENT_A = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e801';
const MOMENT_B = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e802';
const crp = callerWith({ userId: 'crp-1', crpClusterIds: ['cluster-1'] });

/** A model that answers with the given texts in turn, and records what it was asked. */
function scripted(provider: 'groq' | 'claude', answers: (string | CompletionError)[]) {
  const requests: CompletionRequest[] = [];
  const complete = vi.fn((request: CompletionRequest) => {
    requests.push(request);
    const next = answers.shift();
    if (next === undefined) {
      throw new Error('No more answers.');
    }
    if (next instanceof CompletionError) {
      return Promise.reject(next);
    }
    return Promise.resolve({ text: next, model: `${provider}-model`, provider });
  });
  const model: LanguageModel = { provider, model: `${provider}-model`, complete };
  return { model, requests, complete };
}

function fakeServices(overrides: Partial<SahayakServices> = {}) {
  const used = new Map<string, number>();
  const spies = {
    takeQuota: vi.fn((profileId: string, kind: string, limit: number) => {
      const key = `${profileId}:${kind}`;
      const count = used.get(key) ?? 0;
      if (count >= limit) {
        return Promise.resolve(false);
      }
      used.set(key, count + 1);
      return Promise.resolve(true);
    }),
    returnQuota: vi.fn((profileId: string, kind: string) => {
      const key = `${profileId}:${kind}`;
      used.set(key, Math.max(0, (used.get(key) ?? 0) - 1));
      return Promise.resolve();
    }),
    agreedFeedback: vi.fn(() => Promise.resolve(null)),
    namesOfVisit: vi.fn(() =>
      Promise.resolve({ children: [] as string[], teachers: [] as string[] }),
    ),
    namesOfClass: vi.fn(() =>
      Promise.resolve({ children: [] as string[], teachers: [] as string[] }),
    ),
    storedScore: vi.fn(() => Promise.resolve(null)),
    saveScore: vi.fn((score: Omit<FeedbackScore, 'total' | 'scoredAt'>) =>
      Promise.resolve({
        ...score,
        total:
          score.specific +
          score.evidence +
          score.oneFocus +
          score.demonstration +
          score.checkBack +
          score.respectful,
        scoredAt: '2026-10-22T10:00:00.000Z',
      }),
    ),
    saveDebrief: vi.fn((debrief) =>
      Promise.resolve({ ...debrief, id: 'debrief-1', createdAt: '2026-10-22T10:00:00.000Z' }),
    ),
    isDemonstration: vi.fn(() => Promise.resolve(false)),
  };
  const services: SahayakServices = { ...spies, ...overrides };
  return { services, used, spies };
}

function models(overrides: Partial<SahayakModels> = {}): SahayakModels {
  return {
    text: scripted('groq', []).model,
    vision: scripted('groq', []).model,
    chat: scripted('groq', []).model,
    claude: null,
    claudeDailyLimit: 600,
    ...overrides,
  };
}

function bodyOf(result: { body: unknown }) {
  return result.body as Record<string, unknown> & { error?: { code: string } };
}

const visitContext = {
  class_section_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  teacher_id: '4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c3',
  grade: 2,
  lesson: 'Hindi, page 34: the crow and the pot',
  focus: [
    { code: 'every-child-reads', text: 'Every child reads aloud', answer: 'no', note: null },
    {
      code: 'mistakes-handled-kindly',
      text: 'Mistakes are handled kindly',
      answer: 'yes',
      note: null,
    },
  ],
  moments: [
    {
      id: MOMENT_A,
      tag: 'Chorus reading only',
      tone: 'concern',
      minute: 6,
      note: 'Back rows silent',
    },
    { id: MOMENT_B, tag: 'Effort praised', tone: 'strength', minute: 12, note: null },
  ],
  pulse: { checked: 18, needs_support: 7, hesitant: 6, fluent: 5, english_no_response: 4 },
  follow_up: null,
  transcript: null,
  practices: [
    { code: 'paired-reading', title: 'Paired reading', why: 'Every child reads every day.' },
    { code: 'echo-reading', title: 'Echo reading', why: 'Children hear and copy fluent reading.' },
  ],
};

describe('the language-model services', () => {
  function fetcherAnswering(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher: Fetcher = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    return { fetcher, calls };
  }

  const request: CompletionRequest = {
    system: 'Instructions.',
    turns: [{ role: 'user', content: 'Hello' }],
    schema: {
      name: 'thing',
      schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    maxTokens: 300,
    effort: 'medium',
  };

  it('asks Groq for strict JSON, with the reasoning setting the model takes', async () => {
    const { fetcher, calls } = fetcherAnswering(200, {
      model: 'openai/gpt-oss-120b',
      choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
    });
    const answer = await groqModel('key-1', 'openai/gpt-oss-120b', fetcher).complete(request);
    expect(answer).toEqual({ text: '{"a":1}', model: 'openai/gpt-oss-120b', provider: 'groq' });
    const call = calls[0];
    expect(call?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((call?.init.headers as Record<string, string>).authorization).toBe('Bearer key-1');
    const sent = JSON.parse(call?.init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model: 'openai/gpt-oss-120b',
      reasoning_effort: 'medium',
      max_completion_tokens: 300,
      response_format: { type: 'json_schema', json_schema: { name: 'thing', strict: true } },
    });
    expect(sent.messages).toEqual([
      { role: 'system', content: 'Instructions.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('sends a photo to Groq with the last turn, and to Claude before its text', async () => {
    const image = { mediaType: 'image/jpeg', base64: 'AAAA' };
    const groq = fetcherAnswering(200, { choices: [{ message: { content: '{}' } }] });
    await groqModel('k', 'qwen/qwen3.8-27b', groq.fetcher).complete({ ...request, image });
    const groqBody = JSON.parse(groq.calls[0]?.init.body as string) as {
      messages: { content: unknown }[];
      reasoning_effort: string;
    };
    expect(groqBody.reasoning_effort).toBe('none');
    // The instructions travel with the picture, not as a separate message.
    expect(groqBody.messages).toHaveLength(1);
    expect(groqBody.messages[0]?.content).toEqual([
      { type: 'text', text: 'Instructions.\n\nHello' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);

    const claude = fetcherAnswering(200, {
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{}' }],
    });
    await claudeModel('k', 'claude-sonnet-5-5', claude.fetcher).complete({ ...request, image });
    const claudeBody = JSON.parse(claude.calls[0]?.init.body as string) as {
      messages: { content: unknown[] }[];
    };
    expect(claudeBody.messages[0]?.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
  });

  it('caches the instructions for Claude, and replies without thinking first in a conversation', async () => {
    const { fetcher, calls } = fetcherAnswering(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Theek hai.' }],
    });
    const chat: CompletionRequest = {
      system: request.system,
      turns: request.turns,
      maxTokens: request.maxTokens,
      effort: 'low',
    };
    const answer = await claudeModel('key-2', 'claude-sonnet-5-5', fetcher).complete(chat);
    expect(answer.text).toBe('Theek hai.');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('key-2');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const sent = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'Instructions.',
      output_config: { effort: 'low' },
      thinking: { type: 'between_tools' },
    });

    // A structured answer carries its schema and lets the model think.
    await claudeModel('key-2', 'claude-sonnet-5-5', fetcher).complete(request);
    const structured = JSON.parse(calls[1]?.init.body as string) as Record<string, unknown>;
    expect(structured.output_config).toEqual({
      effort: 'medium',
      format: { type: 'json_schema', schema: request.schema?.schema },
    });
    expect(structured.thinking).toBeUndefined();
  });

  it('skips up-front thinking only on the model that takes the setting', async () => {
    const { fetcher, calls } = fetcherAnswering(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Haan.' }],
    });
    const chat: CompletionRequest = {
      system: 'Instructions.',
      turns: [{ role: 'user', content: 'Hello' }],
      maxTokens: 300,
      effort: 'low',
    };
    await claudeModel('k', 'claude-haiku-5-5', fetcher).complete(chat);
    const sent = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(sent.thinking).toBeUndefined();
    expect(sent.output_config).toEqual({ effort: 'low' });
  });

  it('tells apart a missing key, used-up credit, a failing service and a refusal', async () => {
    expect(failureFor('groq', 401, '')).toBe('not_configured');
    expect(failureFor('groq', 429, '')).toBe('busy');
    expect(failureFor('groq', 413, '{"error":{"code":"rate_limit_exceeded"}}')).toBe('busy');
    expect(failureFor('groq', 413, '{"error":{"message":"too big"}}')).toBe('rejected');
    expect(failureFor('claude', 402, '')).toBe('exhausted');
    expect(
      failureFor('claude', 400, '{"error":{"message":"Your credit balance is too low"}}'),
    ).toBe('exhausted');
    expect(failureFor('claude', 400, '{"error":{"message":"bad schema"}}')).toBe('rejected');
    expect(failureFor('groq', 503, '')).toBe('unavailable');

    await expect(groqModel('', 'm', vi.fn()).complete(request)).rejects.toMatchObject({
      reason: 'not_configured',
    });
    const cut = fetcherAnswering(200, {
      choices: [{ message: { content: '{"a"' }, finish_reason: 'length' }],
    });
    await expect(groqModel('k', 'm', cut.fetcher).complete(request)).rejects.toMatchObject({
      reason: 'refused',
    });
    const refusal = fetcherAnswering(200, { stop_reason: 'refusal', content: [] });
    await expect(claudeModel('k', 'm', refusal.fetcher).complete(request)).rejects.toMatchObject({
      reason: 'refused',
    });
    const offline: Fetcher = () => Promise.reject(new TypeError('fetch failed'));
    await expect(groqModel('k', 'm', offline).complete(request)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(() => parseObject({ text: '[1]', model: 'm', provider: 'groq' })).toThrow(
      CompletionError,
    );
  });
});

describe('names', () => {
  it('are replaced whole and in part, in any script, without touching other words', () => {
    const hidden = [
      { name: 'Asha Kumari', label: '[child]' },
      { name: 'Ravi', label: '[child]' },
      { name: 'Sunita Devi', label: '[teacher]' },
      { name: 'राधा', label: '[child]' },
    ];
    expect(
      redactNames(
        'asha kumari read well; Asha helped Ravindra. Sunita ji praised Ravi. राधा ने पढ़ा, राधाकृष्ण नहीं।',
        hidden,
      ),
    ).toBe(
      '[child] read well; [child] helped Ravindra. [teacher] ji praised [child]. [child] ने पढ़ा, राधाकृष्ण नहीं।',
    );
  });

  it('takes out a short whole name too, but never a single letter or part of a word', () => {
    const hidden = [
      { name: 'Om', label: '[child]' },
      { name: 'ओम', label: '[child]' },
      { name: 'A', label: '[child]' },
    ];
    expect(redactNames('Om read; Omkar listened. ओम ने पढ़ा। A good lesson.', hidden)).toBe(
      '[child] read; Omkar listened. [child] ने पढ़ा। A good lesson.',
    );
  });

  it('cuts long text at a word', () => {
    expect(clip('alpha beta gamma delta', 16)).toBe('alpha beta…');
    expect(clip('  short  ', 12)).toBe('short');
  });
});

describe('who may use Sahayak', () => {
  it('is CRPs and administrators, never teachers, families or accounts on a temporary password', async () => {
    for (const caller of [
      callerWith({ teacherSchoolIds: ['school-1'] }),
      callerWith({ accountKind: 'student' }),
      callerWith({ crpClusterIds: ['cluster-1'], passwordChangeRequired: true }),
    ]) {
      const result = await handleSahayak(
        { action: 'rehearse', language: 'hi' },
        caller,
        fakeServices().services,
        models(),
        TODAY,
      );
      expect(result.status).toBe(403);
    }
  });

  it('offers nothing without the Groq key, and checks the action and language', async () => {
    const { services } = fakeServices();
    const none = await handleSahayak(
      { action: 'draft_feedback', language: 'hi', visit: visitContext },
      crp,
      services,
      models({ text: null }),
      TODAY,
    );
    expect(none.status).toBe(503);
    expect(bodyOf(none).error?.code).toBe('not_configured');
    for (const body of [
      { action: 'translate', language: 'hi' },
      { action: 'rehearse', language: 'fr' },
      null,
    ]) {
      expect((await handleSahayak(body, crp, services, models(), TODAY)).status).toBe(400);
    }
  });
});

describe('drafting feedback', () => {
  const draftAnswer = JSON.stringify({
    strength: 'You praised effort warmly.',
    evidence_moments: [MOMENT_B, MOMENT_B, '9f9f9f9f-0000-4000-8000-000000000000'],
    evidence_items: ['mistakes-handled-kindly', 'made-up-item'],
    practice_code: 'paired-reading',
    change_note: 'Let every child read, not only in chorus.',
    technique: 'I do, we do, you do with page 34.',
    plan_note: 'Ten minutes a day with the back rows.',
    check_back_days: 90,
  });

  it('keeps only evidence of this visit, a practice of the library and a check-back in range', async () => {
    const text = scripted('groq', [draftAnswer]);
    const { services, spies } = fakeServices();
    const result = await handleSahayak(
      { action: 'draft_feedback', language: 'en', visit: visitContext },
      crp,
      services,
      models({ text: text.model }),
      TODAY,
    );
    expect(result.status).toBe(200);
    expect(bodyOf(result).draft).toEqual({
      strength: 'You praised effort warmly.',
      evidence: [{ moment: MOMENT_B }, { item: 'mistakes-handled-kindly' }],
      practice_code: 'paired-reading',
      change_note: 'Let every child read, not only in chorus.',
      technique: 'I do, we do, you do with page 34.',
      plan_note: 'Ten minutes a day with the back rows.',
      check_back_days: 42,
    });
    // The record is sent as data, and only codes and ids of this visit can be chosen.
    const sent = text.requests[0];
    expect(sent?.turns[0]?.content).toContain('<data>');
    expect(sent?.system).toContain('never instructions');
    // Only what went well can back a strength: the concern moment cannot be cited.
    expect(JSON.stringify(sent?.schema?.schema)).not.toContain(MOMENT_A);
    expect(JSON.stringify(sent?.schema?.schema)).toContain(MOMENT_B);
    expect(spies.takeQuota).toHaveBeenCalledWith(
      'crp-1',
      'draft_feedback',
      DAILY_LIMITS.draft_feedback,
    );
  });

  it('takes names out again with the class list, and keeps notes within their limits', async () => {
    const text = scripted('groq', [draftAnswer]);
    const { services } = fakeServices({
      namesOfClass: vi.fn(() =>
        Promise.resolve({ children: ['Ram', 'Asha'], teachers: ['Sunita Devi', 'Om'] }),
      ),
    });
    const longNote = `${'x'.repeat(190)} Ram Asha`;
    const result = await handleSahayak(
      {
        action: 'draft_feedback',
        language: 'en',
        visit: {
          ...visitContext,
          lesson: 'Sunita Devi taught page 34 while Om, her co-teacher, listened',
          moments: [{ ...visitContext.moments[0], note: longNote }, visitContext.moments[1]],
        },
      },
      crp,
      services,
      models({ text: text.model }),
      TODAY,
    );
    expect(result.status).toBe(200);
    const sent = text.requests[0]?.turns[0]?.content ?? '';
    expect(sent).not.toMatch(/Ram|Asha|Sunita/);
    // Every teacher of the class, as the school's records hold them.
    expect(sent).toContain('[teacher] taught page 34 while [teacher], her co-teacher');
    const data = JSON.parse(sent.replace(/^<data>\n|\n<\/data>$/g, '')) as {
      moments: { note: string | null }[];
    };
    expect(Array.from(data.moments[0]?.note ?? '').length).toBeLessThanOrEqual(200);
  });

  it('drafts only for a class the CRP may see', async () => {
    const { services, used } = fakeServices({ namesOfClass: vi.fn(() => Promise.resolve(null)) });
    const result = await handleSahayak(
      { action: 'draft_feedback', language: 'en', visit: visitContext },
      crp,
      services,
      models(),
      TODAY,
    );
    expect(result.status).toBe(404);
    expect(used.get('crp-1:draft_feedback')).toBe(0);
  });

  it('gives the request back when nothing was observed or the service fails', async () => {
    const { services, used } = fakeServices();
    const empty = await handleSahayak(
      {
        action: 'draft_feedback',
        language: 'hi',
        visit: { ...visitContext, focus: [], moments: [] },
      },
      crp,
      services,
      models(),
      TODAY,
    );
    expect(empty.status).toBe(400);
    const failing = scripted('groq', [new CompletionError('unavailable', 'groq', 'HTTP 503')]);
    const down = await handleSahayak(
      { action: 'draft_feedback', language: 'hi', visit: visitContext },
      crp,
      services,
      models({ text: failing.model }),
      TODAY,
    );
    expect(down.status).toBe(503);
    expect(bodyOf(down).error?.code).toBe('ai_unavailable');
    expect(used.get('crp-1:draft_feedback')).toBe(0);
  });

  it('counts a request the model answered with something unusable, and not one turned down', async () => {
    const { services, used } = fakeServices();
    // An answer was generated, but without a practice of the library.
    const unusable = scripted('groq', [JSON.stringify({ strength: 'Good lesson.' })]);
    const refused = await handleSahayak(
      { action: 'draft_feedback', language: 'hi', visit: visitContext },
      crp,
      services,
      models({ text: unusable.model }),
      TODAY,
    );
    expect(refused.status).toBe(422);
    expect(used.get('crp-1:draft_feedback')).toBe(1);

    const turnedDown = scripted('groq', [new CompletionError('rejected', 'groq', 'HTTP 413')]);
    const tooLong = await handleSahayak(
      { action: 'draft_feedback', language: 'hi', visit: visitContext },
      crp,
      services,
      models({ text: turnedDown.model }),
      TODAY,
    );
    expect(tooLong.status).toBe(422);
    expect(used.get('crp-1:draft_feedback')).toBe(1);
  });

  it('gives a demonstration visitor a smaller allowance, shared with every other visitor', async () => {
    const { services, used } = fakeServices({
      isDemonstration: vi.fn(() => Promise.resolve(true)),
    });
    const ask = () =>
      handleSahayak(
        { action: 'draft_feedback', language: 'hi', visit: visitContext },
        crp,
        services,
        models({ text: scripted('groq', [draftAnswer]).model }),
        TODAY,
      );
    for (let asked = 0; asked < DEMO_DAILY_LIMITS.draft_feedback; asked += 1) {
      expect((await ask()).status).toBe(200);
    }
    expect(used.get(`${PROJECT_ID}:demo_draft_feedback`)).toBe(DEMO_DAILY_LIMITS.draft_feedback);
    const over = await ask();
    expect(over.status).toBe(429);
    expect(bodyOf(over).error?.code).toBe('quota_exceeded');

    // Once all visitors together have used the day's share, a new visitor is refused as well, and
    // their own allowance is not touched.
    const other = fakeServices({ isDemonstration: vi.fn(() => Promise.resolve(true)) });
    other.used.set(`${PROJECT_ID}:demo_draft_feedback`, DEMO_PROJECT_LIMITS.draft_feedback);
    const shared = await handleSahayak(
      { action: 'draft_feedback', language: 'hi', visit: visitContext },
      callerWith({ userId: 'crp-2', crpClusterIds: ['cluster-1'] }),
      other.services,
      models({ text: scripted('groq', [draftAnswer]).model }),
      TODAY,
    );
    expect(shared.status).toBe(429);
    expect(other.used.get('crp-2:draft_feedback')).toBe(0);
  });

  it('stops at the daily allowance without asking the service', async () => {
    const text = scripted('groq', []);
    const { services } = fakeServices({ takeQuota: vi.fn(() => Promise.resolve(false)) });
    const result = await handleSahayak(
      { action: 'draft_feedback', language: 'hi', visit: visitContext },
      crp,
      services,
      models({ text: text.model }),
      TODAY,
    );
    expect(result.status).toBe(429);
    expect(bodyOf(result).error?.code).toBe('quota_exceeded');
    expect(text.complete).not.toHaveBeenCalled();
  });
});

describe('scoring feedback', () => {
  const agreed: AgreedFeedback = {
    visitId: VISIT,
    classSectionId: 'class-1',
    teacherId: 'teacher-1',
    visitedOn: '2026-10-20',
    lessonNote: 'Sunita Devi taught page 34',
    strength: 'Asha Kumari read her line clearly and you praised her.',
    evidence: [{ moment: MOMENT_A }, { item: 'every-child-reads' }],
    practiceCode: 'paired-reading',
    changeNote: 'Pairs read to each other.',
    technique: null,
    demoGiven: true,
    planNote: 'Ten minutes daily.',
    checkBackOn: '2026-11-05',
    language: 'hi',
    agreedAt: '2026-10-20T08:00:00.000Z',
    moments: [{ id: MOMENT_A, tagCode: 'chorus-only', note: 'Asha was silent' }],
  };

  it('counts what can be counted, judges the rest without names, and keeps the score', async () => {
    const text = scripted('groq', [
      JSON.stringify({ specific: 2, one_focus: 2, respectful: 1, tip: 'Name the page.' }),
    ]);
    const { services, spies } = fakeServices({
      agreedFeedback: vi.fn(() => Promise.resolve(agreed)),
      namesOfVisit: vi.fn(() =>
        Promise.resolve({ children: ['Asha Kumari'], teachers: ['Sunita Devi'] }),
      ),
    });
    const result = await handleSahayak(
      { action: 'score_feedback', language: 'hi', visit_id: VISIT },
      crp,
      services,
      models({ text: text.model }),
      TODAY,
    );
    expect(result.status).toBe(200);
    expect(bodyOf(result).score).toMatchObject({
      specific: 2,
      evidence: 2,
      one_focus: 2,
      demonstration: 2,
      check_back: 1,
      respectful: 1,
      total: 10,
      tip: 'Name the page.',
    });
    const sent = text.requests[0]?.turns[0]?.content ?? '';
    expect(sent).not.toMatch(/Asha|Sunita/);
    expect(sent).toContain('[child]');
    expect(spies.saveScore).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: VISIT, feedbackAgreedAt: agreed.agreedAt }),
      'crp-1',
    );
  });

  it('answers from the kept score while the feedback is unchanged, and refuses others', async () => {
    const held: FeedbackScore = {
      visitId: VISIT,
      specific: 1,
      evidence: 1,
      oneFocus: 1,
      demonstration: 1,
      checkBack: 1,
      respectful: 1,
      total: 6,
      tip: 'Tip.',
      language: 'hi',
      model: 'm',
      feedbackAgreedAt: agreed.agreedAt,
      feedbackFingerprint: await feedbackFingerprint({
        strength: agreed.strength,
        evidence: [`moment:${MOMENT_A}`, 'item:every-child-reads'],
        practiceCode: agreed.practiceCode,
        changeNote: agreed.changeNote,
        technique: agreed.technique,
        demoGiven: agreed.demoGiven,
        planNote: agreed.planNote,
        checkBackOn: agreed.checkBackOn,
      }),
      scoredAt: '2026-10-21T08:00:00.000Z',
    };
    const { services, spies } = fakeServices({
      agreedFeedback: vi.fn(() => Promise.resolve(agreed)),
      storedScore: vi.fn(() => Promise.resolve(held)),
    });
    const result = await handleSahayak(
      { action: 'score_feedback', language: 'hi', visit_id: VISIT },
      crp,
      services,
      models(),
      TODAY,
    );
    expect(bodyOf(result)).toMatchObject({ cached: true, score: { total: 6 } });
    expect(spies.takeQuota).not.toHaveBeenCalled();

    // Feedback edited after it was scored is scored again.
    const edited = fakeServices({
      agreedFeedback: vi.fn(() => Promise.resolve({ ...agreed, planNote: 'Five minutes daily.' })),
      storedScore: vi.fn(() => Promise.resolve(held)),
    });
    const again = await handleSahayak(
      { action: 'score_feedback', language: 'hi', visit_id: VISIT },
      crp,
      edited.services,
      models({
        text: scripted('groq', [
          JSON.stringify({ specific: 1, one_focus: 1, respectful: 2, tip: 'Tip.' }),
        ]).model,
      }),
      TODAY,
    );
    expect(bodyOf(again)).toMatchObject({ cached: false });
    expect(edited.spies.saveScore).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      }),
      'crp-1',
    );

    const missing = await handleSahayak(
      { action: 'score_feedback', language: 'hi', visit_id: VISIT },
      crp,
      fakeServices().services,
      models(),
      TODAY,
    );
    expect(missing.status).toBe(404);
  });

  it('counts evidence, the demonstration and how soon the check-back is', () => {
    const base = { visitedOn: '2026-10-01', technique: null, demoGiven: false };
    expect(countedParts({ ...base, evidence: [], checkBackOn: '2026-10-15' })).toEqual({
      evidence: 0,
      demonstration: 0,
      checkBack: 2,
    });
    expect(
      countedParts({
        ...base,
        evidence: [1],
        technique: 'x'.repeat(80),
        checkBackOn: '2026-10-22',
      }),
    ).toEqual({ evidence: 1, demonstration: 1, checkBack: 1 });
    expect(
      countedParts({ ...base, evidence: [1, 2, 3], checkBackOn: '2026-10-30' }).checkBack,
    ).toBe(0);
  });
});

describe('reading an order', () => {
  const image = 'A'.repeat(400);

  it('keeps real deadlines of the coming year and at most ten tasks', async () => {
    const vision = scripted('groq', [
      JSON.stringify({
        readable: true,
        issuer: 'BEO Rampur',
        order_date: '2026-10-20',
        tasks: [
          { title: 'Submit the library register', details: null, due_on: '2026-10-30' },
          { title: 'Hold the parents meeting', details: 'In every school.', due_on: '2026-02-30' },
          { title: 'Old task', details: null, due_on: '2025-01-01' },
          ...Array.from({ length: 12 }, (_, index) => ({
            title: `Task ${String(index)}`,
            details: null,
            due_on: null,
          })),
        ],
      }),
    ]);
    const result = await handleSahayak(
      { action: 'read_order', language: 'hi', media_type: 'image/jpeg', image },
      crp,
      fakeServices().services,
      models({ vision: vision.model }),
      TODAY,
    );
    const body = bodyOf(result) as { tasks: { title: string; due_on: string | null }[] };
    expect(result.status).toBe(200);
    expect(body.tasks).toHaveLength(10);
    expect(body.tasks.slice(0, 3)).toEqual([
      { title: 'Submit the library register', details: null, due_on: '2026-10-30' },
      { title: 'Hold the parents meeting', details: 'In every school.', due_on: null },
      { title: 'Old task', details: null, due_on: null },
    ]);
    expect(vision.requests[0]?.image).toEqual({ mediaType: 'image/jpeg', base64: image });
    expect(vision.requests[0]?.system).toContain(TODAY);
  });

  it('refuses what is not a picture, and lists nothing from an unreadable one', async () => {
    const { services } = fakeServices();
    for (const body of [
      { media_type: 'image/gif', image },
      { media_type: 'image/jpeg', image: 'not base64!' },
      { media_type: 'image/jpeg', image: 'A'.repeat(2_000_001) },
    ]) {
      const result = await handleSahayak(
        { action: 'read_order', language: 'hi', ...body },
        crp,
        services,
        models(),
        TODAY,
      );
      expect(result.status).toBe(400);
    }
    const vision = scripted('groq', [
      JSON.stringify({
        readable: false,
        issuer: null,
        order_date: null,
        tasks: [{ title: 'x', details: null, due_on: null }],
      }),
    ]);
    const result = await handleSahayak(
      { action: 'read_order', language: 'hi', media_type: 'image/png', image },
      crp,
      services,
      models({ vision: vision.model }),
      TODAY,
    );
    expect(bodyOf(result)).toMatchObject({ readable: false, tasks: [] });
  });
});

describe('the rehearsal room', () => {
  const scenario = SCENARIOS[0]?.code ?? '';
  const conversation = [
    { role: 'teacher', text: 'Half of them do not come every day.' },
    { role: 'crp', text: 'That is hard. What helps the ones who come?' },
  ];

  it('plays the teacher with Claude, the conversation starting on the CRP side', async () => {
    const claude = scripted('claude', ['They like stories.']);
    const { services, spies } = fakeServices();
    const result = await handleSahayak(
      { action: 'rehearse', language: 'en', scenario, messages: conversation },
      crp,
      services,
      models({ claude: claude.model }),
      TODAY,
    );
    expect(bodyOf(result)).toEqual({ reply: 'They like stories.', provider: 'claude' });
    const sent = claude.requests[0];
    expect(sent?.turns.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent?.effort).toBe('low');
    expect(spies.takeQuota).toHaveBeenCalledWith(PROJECT_ID, 'claude', 600);
  });

  it('keeps Claude for real CRPs: a demonstration visitor rehearses with Groq', async () => {
    const claude = scripted('claude', ['They like stories.']);
    const chat = scripted('groq', ['Bachche kahaniyan pasand karte hain.']);
    const { services, spies } = fakeServices({
      isDemonstration: vi.fn(() => Promise.resolve(true)),
    });
    const result = await handleSahayak(
      { action: 'rehearse', language: 'hi', scenario, messages: conversation },
      crp,
      services,
      models({ claude: claude.model, chat: chat.model }),
      TODAY,
    );
    expect(bodyOf(result)).toEqual({
      reply: 'Bachche kahaniyan pasand karte hain.',
      provider: 'groq',
    });
    expect(claude.complete).not.toHaveBeenCalled();
    expect(spies.takeQuota).not.toHaveBeenCalledWith(PROJECT_ID, 'claude', 600);
  });

  it('moves to Groq when the credit is used up, keeping the project count', async () => {
    const claude = scripted('claude', [new CompletionError('exhausted', 'claude', 'HTTP 400')]);
    const chat = scripted('groq', ['Theek hai, dekhte hain.']);
    const { services, used } = fakeServices();
    const result = await handleSahayak(
      { action: 'rehearse', language: 'hi', scenario, messages: conversation },
      crp,
      services,
      models({ claude: claude.model, chat: chat.model }),
      TODAY,
    );
    expect(bodyOf(result)).toEqual({ reply: 'Theek hai, dekhte hain.', provider: 'groq' });
    expect(used.get(`${PROJECT_ID}:claude`)).toBe(1);
    expect(used.get('crp-1:claude')).toBe(1);

    // A passing failure of Claude costs the project and the person nothing.
    const flaky = scripted('claude', [new CompletionError('busy', 'claude', 'HTTP 429')]);
    await handleSahayak(
      { action: 'rehearse', language: 'hi', scenario, messages: conversation },
      crp,
      services,
      models({ claude: flaky.model, chat: scripted('groq', ['Haan.']).model }),
      TODAY,
    );
    expect(used.get(`${PROJECT_ID}:claude`)).toBe(1);

    // An answer Claude generated but that could not be used is paid for, so it stays counted.
    const unusable = scripted('claude', [new CompletionError('refused', 'claude', 'stop refusal')]);
    await handleSahayak(
      { action: 'rehearse', language: 'hi', scenario, messages: conversation },
      crp,
      services,
      models({ claude: unusable.model, chat: scripted('groq', ['Haan.']).model }),
      TODAY,
    );
    expect(used.get(`${PROJECT_ID}:claude`)).toBe(2);
    expect(used.get('crp-1:claude')).toBe(2);

    // And when the project's allowance is spent, Claude is not asked at all.
    const spent = scripted('claude', []);
    await handleSahayak(
      { action: 'rehearse', language: 'hi', scenario, messages: conversation },
      crp,
      services,
      models({ claude: spent.model, chat: scripted('groq', ['Haan.']).model, claudeDailyLimit: 2 }),
      TODAY,
    );
    expect(spent.complete).not.toHaveBeenCalled();
    expect(used.get('crp-1:claude')).toBe(2);

    // Nor when the person's own share is spent, which leaves the project's for others.
    const other = fakeServices();
    const share = scripted('claude', []);
    for (let taken = 0; taken < CLAUDE_PER_PERSON; taken += 1) {
      await other.services.takeQuota('crp-1', 'claude', CLAUDE_PER_PERSON);
    }
    await handleSahayak(
      { action: 'rehearse', language: 'hi', scenario, messages: conversation },
      crp,
      other.services,
      models({ claude: share.model, chat: scripted('groq', ['Haan.']).model }),
      TODAY,
    );
    expect(share.complete).not.toHaveBeenCalled();
    expect(other.used.get(`${PROJECT_ID}:claude`) ?? 0).toBe(0);
  });

  it('takes turns in order, the CRP last, and only known scenarios', async () => {
    const { services } = fakeServices();
    for (const body of [
      { scenario: 'unknown-room', messages: conversation },
      { scenario, messages: [...conversation, { role: 'teacher', text: 'Hmm.' }] },
      {
        scenario,
        messages: [
          { role: 'crp', text: 'a' },
          { role: 'crp', text: 'b' },
        ],
      },
      { scenario, messages: [{ role: 'crp', text: 'x'.repeat(801) }] },
    ]) {
      const result = await handleSahayak(
        { action: 'rehearse', language: 'hi', ...body },
        crp,
        services,
        models(),
        TODAY,
      );
      expect(result.status).toBe(400);
    }
  });

  it('keeps the debrief of a conversation of at least two turns', async () => {
    const claude = scripted('claude', [
      JSON.stringify({
        named_practice: true,
        asked_constraints: true,
        agreed_check_back: false,
        kept_blame_out: true,
        cited_evidence: false,
        went_well: 'You asked what helps.',
        try_next: 'Agree a day: "Shall I come back on Monday?"',
      }),
    ]);
    const { services, spies } = fakeServices();
    const messages = [
      ...conversation,
      { role: 'teacher', text: 'Stories, maybe.' },
      { role: 'crp', text: 'Let us try paired reading with the story.' },
      { role: 'teacher', text: 'All right.' },
    ];
    const result = await handleSahayak(
      { action: 'debrief', language: 'en', scenario, messages },
      crp,
      services,
      models({ claude: claude.model }),
      TODAY,
    );
    expect(result.status).toBe(200);
    expect(bodyOf(result).debrief).toMatchObject({
      scenario,
      turns: 2,
      named_practice: true,
      agreed_check_back: false,
      provider: 'claude',
    });
    expect(claude.requests[0]?.schema?.name).toBe('rehearsal_debrief');
    expect(spies.saveDebrief).toHaveBeenCalledWith(
      expect.objectContaining({ scenario, turns: 2 }),
      'crp-1',
    );

    const short = await handleSahayak(
      { action: 'debrief', language: 'en', scenario, messages: conversation },
      crp,
      services,
      models(),
      TODAY,
    );
    expect(short.status).toBe(400);
  });
});
