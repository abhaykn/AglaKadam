import { describe, expect, it, vi } from 'vitest';
import { ProviderBreaker, PROJECT_ID } from '../../../supabase/functions/_shared/failover.ts';
import {
  CompletionError,
  type CompletionRequest,
  type LanguageModel,
} from '../../../supabase/functions/_shared/llm.ts';
import {
  CLAUDE_PER_PERSON,
  DAILY_LIMIT,
  DEMO_DAILY_LIMIT,
  DEMO_PROJECT_LIMIT,
  handleDisha,
  personasOf,
  type DishaModels,
  type DishaServices,
} from '../../../supabase/functions/disha/handler.ts';
import { tutorSystem } from '../../../supabase/functions/disha/prompts.ts';
import { scrubPersonalDetails } from '../../../supabase/functions/disha/scrub.ts';
import { callerWith } from './support/fake-services.ts';

const teacher = callerWith({ userId: 'teacher-1', teacherSchoolIds: ['school-1'] });
const crp = callerWith({ userId: 'crp-1', crpClusterIds: ['cluster-1'] });
const officer = callerWith({ userId: 'officer-1' });
const family = callerWith({ userId: 'family-1', accountKind: 'student' });

/** A model that answers with the given texts (or failures) in turn, and records its requests. */
function scripted(
  provider: 'groq' | 'claude',
  name: string,
  answers: (string | CompletionError)[],
) {
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
    return Promise.resolve({ text: next, model: name, provider });
  });
  const model: LanguageModel = { provider, model: name, complete };
  return { model, requests, complete };
}

function services(demonstrations: string[] = []) {
  const used = new Map<string, number>();
  const takeQuota = vi.fn((profileId: string, kind: string, limit: number) => {
    const key = `${profileId}:${kind}`;
    const count = used.get(key) ?? 0;
    if (count >= limit) {
      return Promise.resolve(false);
    }
    used.set(key, count + 1);
    return Promise.resolve(true);
  });
  const returnQuota = vi.fn((profileId: string, kind: string) => {
    const key = `${profileId}:${kind}`;
    used.set(key, Math.max(0, (used.get(key) ?? 0) - 1));
    return Promise.resolve();
  });
  const value: DishaServices = {
    takeQuota,
    returnQuota,
    isDemonstration: (profileId) => Promise.resolve(demonstrations.includes(profileId)),
  };
  return { value, used, takeQuota, returnQuota };
}

function modelsOf(
  claude: LanguageModel | null,
  groq: LanguageModel[],
  breaker = new ProviderBreaker(),
): DishaModels {
  return { claude, groq, claudeDailyLimit: 600, breaker };
}

function question(text = 'What is a fraction?', persona = 'teacher', language = 'en') {
  return {
    action: 'chat',
    persona,
    language,
    messages: [{ role: 'user', text }],
  };
}

const exhausted = () => new CompletionError('exhausted', 'claude', 'HTTP 400');
const busy = (provider: 'groq' | 'claude' = 'claude') =>
  new CompletionError('busy', provider, 'HTTP 429');

describe('Disha: the order of the services', () => {
  it('asks Claude first and says who answered', async () => {
    const claude = scripted('claude', 'claude-sonnet-5-5', ['A fraction is a part of a whole.']);
    const groq = scripted('groq', 'gpt-oss', []);
    const result = await handleDisha(
      question(),
      teacher,
      services().value,
      modelsOf(claude.model, [groq.model]),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      reply: 'A fraction is a part of a whole.',
      provider: 'claude',
      fell_back: false,
    });
    expect(groq.complete).not.toHaveBeenCalled();
  });

  it('answers from Groq when the Claude credit is used up, and leaves Claude alone afterwards', async () => {
    const claude = scripted('claude', 'claude-sonnet-5-5', [exhausted()]);
    const groq = scripted('groq', 'gpt-oss', ['First answer.', 'Second answer.']);
    const models = modelsOf(claude.model, [groq.model]);
    const first = await handleDisha(question(), teacher, services().value, models);
    expect(first.body).toMatchObject({ reply: 'First answer.', provider: 'groq', fell_back: true });

    // Claude is not asked again while it rests: no failed call for every question.
    const second = await handleDisha(question(), teacher, services().value, models);
    expect(second.body).toMatchObject({ reply: 'Second answer.', provider: 'groq' });
    expect(claude.complete).toHaveBeenCalledTimes(1);
  });

  it('asks Claude again once its rest is over', async () => {
    let now = 0;
    const breaker = new ProviderBreaker(() => now);
    const claude = scripted('claude', 'claude-sonnet-5-5', [exhausted(), 'Back again.']);
    const groq = scripted('groq', 'gpt-oss', ['From Groq.']);
    const models = modelsOf(claude.model, [groq.model], breaker);
    await handleDisha(question(), teacher, services().value, models);
    now += 61 * 60_000;
    const later = await handleDisha(question(), teacher, services().value, models);
    expect(later.body).toMatchObject({ reply: 'Back again.', provider: 'claude' });
  });

  it('falls back for every kind of failure of Claude', async () => {
    const failures = [
      new CompletionError('busy', 'claude', 'HTTP 429'),
      new CompletionError('unavailable', 'claude', 'HTTP 500'),
      new CompletionError('not_configured', 'claude', 'HTTP 401'),
      new CompletionError('rejected', 'claude', 'HTTP 400'),
      new CompletionError('refused', 'claude', 'stop refusal'),
    ];
    for (const failed of failures) {
      const claude = scripted('claude', 'claude-sonnet-5-5', [failed]);
      const groq = scripted('groq', 'gpt-oss', ['Answer.']);
      const result = await handleDisha(
        question(),
        teacher,
        services().value,
        modelsOf(claude.model, [groq.model]),
      );
      expect(result.status, failed.reason).toBe(200);
      expect(result.body).toMatchObject({ provider: 'groq', fell_back: true });
    }
  });

  it('tries the next Groq model when the first is busy', async () => {
    const first = scripted('groq', 'gpt-oss', [busy('groq')]);
    const second = scripted('groq', 'llama', ['From the second model.']);
    const result = await handleDisha(
      question(),
      teacher,
      services().value,
      modelsOf(null, [first.model, second.model]),
    );
    expect(result.body).toMatchObject({ reply: 'From the second model.', provider: 'groq' });
  });

  it('works with Groq alone, and with Claude alone', async () => {
    const groq = scripted('groq', 'gpt-oss', ['Groq alone.']);
    const withGroq = await handleDisha(
      question(),
      teacher,
      services().value,
      modelsOf(null, [groq.model]),
    );
    expect(withGroq.body).toMatchObject({ provider: 'groq' });

    const claude = scripted('claude', 'claude-sonnet-5-5', ['Claude alone.']);
    const withClaude = await handleDisha(
      question(),
      teacher,
      services().value,
      modelsOf(claude.model, []),
    );
    expect(withClaude.body).toMatchObject({ provider: 'claude' });
  });

  it('says so when neither service is set up', async () => {
    const result = await handleDisha(question(), teacher, services().value, modelsOf(null, []));
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'not_configured' } });
  });

  it('gives the question back when no service could answer', async () => {
    const claude = scripted('claude', 'claude-sonnet-5-5', [exhausted()]);
    const groq = scripted('groq', 'gpt-oss', [busy('groq')]);
    const held = services();
    const result = await handleDisha(
      question(),
      teacher,
      held.value,
      modelsOf(claude.model, [groq.model]),
    );
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'ai_unavailable' } });
    expect(held.used.get('teacher-1:tutor')).toBe(0);
  });

  it('counts a Claude request that failed only when the credit was the reason', async () => {
    const held = services();
    const claude = scripted('claude', 'claude-sonnet-5-5', [busy()]);
    const groq = scripted('groq', 'gpt-oss', ['Answer.']);
    await handleDisha(question(), teacher, held.value, modelsOf(claude.model, [groq.model]));
    expect(held.used.get('teacher-1:claude')).toBe(0);
    expect(held.used.get(`${PROJECT_ID}:claude`)).toBe(0);
    expect(held.used.get('teacher-1:tutor')).toBe(1);
  });
});

describe('Disha: allowances', () => {
  it('stops a person at the daily limit', async () => {
    const held = services();
    const groq = scripted(
      'groq',
      'gpt-oss',
      Array.from({ length: DAILY_LIMIT }, () => 'Ok.'),
    );
    const models = modelsOf(null, [groq.model]);
    for (let index = 0; index < DAILY_LIMIT; index += 1) {
      expect((await handleDisha(question(), teacher, held.value, models)).status).toBe(200);
    }
    const over = await handleDisha(question(), teacher, held.value, models);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: { code: 'quota_exceeded' } });
  });

  it('gives a demonstration visitor a smaller allowance, shared by the whole project', async () => {
    const held = services(['family-1']);
    const groq = scripted(
      'groq',
      'gpt-oss',
      Array.from({ length: DEMO_DAILY_LIMIT }, () => 'Ok.'),
    );
    const models = modelsOf(null, [groq.model]);
    for (let index = 0; index < DEMO_DAILY_LIMIT; index += 1) {
      expect((await handleDisha(question('Hi', 'family'), family, held.value, models)).status).toBe(
        200,
      );
    }
    expect((await handleDisha(question('Hi', 'family'), family, held.value, models)).status).toBe(
      429,
    );

    const crowded = services(['family-1']);
    crowded.used.set(`${PROJECT_ID}:demo_tutor`, DEMO_PROJECT_LIMIT);
    const refused = await handleDisha(
      question('Hi', 'family'),
      family,
      crowded.value,
      modelsOf(null, [scripted('groq', 'gpt-oss', ['Ok.']).model]),
    );
    expect(refused.status).toBe(429);
    // The person's own request is given back when the project's allowance is what is spent.
    expect(crowded.used.get('family-1:tutor')).toBe(0);
  });

  it('keeps each person to a share of the Claude allowance', async () => {
    const held = services();
    held.used.set('teacher-1:claude', CLAUDE_PER_PERSON);
    const claude = scripted('claude', 'claude-sonnet-5-5', ['Never asked.']);
    const groq = scripted('groq', 'gpt-oss', ['From Groq.']);
    const result = await handleDisha(
      question(),
      teacher,
      held.value,
      modelsOf(claude.model, [groq.model]),
    );
    expect(result.body).toMatchObject({ provider: 'groq' });
    expect(claude.complete).not.toHaveBeenCalled();
  });
});

describe('Disha: who may speak as whom', () => {
  it('lets each kind of person speak as their own role only', async () => {
    expect(personasOf(teacher)).toEqual(['teacher']);
    expect(personasOf(crp)).toEqual(['crp']);
    expect(personasOf(officer)).toEqual(['officer']);
    expect(personasOf(family)).toEqual(['family']);
    expect(personasOf(callerWith({ isSuperAdmin: true }))).toEqual(['admin', 'officer']);
    expect(personasOf(callerWith({ teacherSchoolIds: ['a'], crpClusterIds: ['b'] }))).toEqual([
      'crp',
      'teacher',
    ]);

    const groq = scripted('groq', 'gpt-oss', ['Never.']);
    const models = modelsOf(null, [groq.model]);
    for (const [caller, persona] of [
      [teacher, 'crp'],
      [crp, 'admin'],
      [family, 'teacher'],
      [officer, 'family'],
    ] as const) {
      const result = await handleDisha(question('Hi', persona), caller, services().value, models);
      expect(result.status, persona).toBe(403);
    }
    expect(groq.complete).not.toHaveBeenCalled();
  });

  it('turns away an account that must change its password first', async () => {
    const groq = scripted('groq', 'gpt-oss', ['Never.']);
    const result = await handleDisha(
      question(),
      callerWith({ teacherSchoolIds: ['a'], passwordChangeRequired: true }),
      services().value,
      modelsOf(null, [groq.model]),
    );
    expect(result.status).toBe(403);
  });

  it('speaks to each role in its own manner and in the chosen language', () => {
    const forChild = tutorSystem('family', 'hi');
    expect(forChild).toContain('child');
    expect(forChild).toContain('Devanagari');
    expect(tutorSystem('crp', 'en')).toContain('Cluster Resource Person');
    expect(tutorSystem('officer', 'en')).toContain('Never rank');
    expect(tutorSystem('teacher', 'en')).toContain('Indian English');
  });
});

describe('Disha: what is sent', () => {
  it('takes phone numbers, email addresses and codes out of the conversation', async () => {
    const groq = scripted('groq', 'gpt-oss', ['Ok.']);
    await handleDisha(
      question(
        'Call me on 98765 43210 or +91 9876543210, mail asha.k@example.com, learner 1234567890. What is 7 + 5?',
      ),
      teacher,
      services().value,
      modelsOf(null, [groq.model]),
    );
    const sent = groq.requests[0]?.turns.map((turn) => turn.content).join(' ') ?? '';
    expect(sent).not.toMatch(/9876|asha|example|123456/);
    expect(sent).toContain('What is 7 + 5?');
    expect(sent).toContain('[email]');
    expect(sent).toContain('[number]');
  });

  it('leaves ordinary numbers in maths questions alone', () => {
    expect(scrubPersonalDetails('What is 1250 + 3475? And 12 x 12?')).toBe(
      'What is 1250 + 3475? And 12 x 12?',
    );
  });

  it('tells the service who is asking and sends the whole conversation', async () => {
    const groq = scripted('groq', 'gpt-oss', ['Ok.']);
    await handleDisha(
      {
        action: 'chat',
        persona: 'family',
        language: 'hi',
        messages: [
          { role: 'user', text: 'Hello' },
          { role: 'assistant', text: 'Namaste!' },
          { role: 'user', text: '2 + 2 kya hota hai?' },
        ],
      },
      family,
      services().value,
      modelsOf(null, [groq.model]),
    );
    const request = groq.requests[0];
    expect(request?.system).toContain('Devanagari');
    expect(request?.turns.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('Disha: requests it refuses', () => {
  const groq = () => modelsOf(null, [scripted('groq', 'gpt-oss', ['Never.']).model]);
  const bad = async (body: unknown) =>
    (await handleDisha(body, teacher, services().value, groq())).status;

  it('needs a conversation that ends with the person', async () => {
    expect(await bad({ ...question(), messages: [{ role: 'assistant', text: 'Hi' }] })).toBe(400);
    expect(await bad({ ...question(), messages: [] })).toBe(400);
    expect(
      await bad({
        ...question(),
        messages: [
          { role: 'user', text: 'One' },
          { role: 'user', text: 'Two' },
        ],
      }),
    ).toBe(400);
  });

  it('refuses unknown fields and values, and texts that are too long', async () => {
    expect(await bad(null)).toBe(400);
    expect(await bad({ ...question(), action: 'delete' })).toBe(400);
    expect(await bad({ ...question(), language: 'fr' })).toBe(400);
    expect(await bad({ ...question(), persona: 'root' })).toBe(400);
    expect(await bad({ ...question('x'.repeat(1501)) })).toBe(400);
    expect(
      await bad({
        ...question(),
        messages: Array.from({ length: 25 }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: 'Hi',
        })),
      }),
    ).toBe(400);
  });

  it('does not spend any allowance on a request that is malformed', async () => {
    const held = services();
    await handleDisha(question(''), teacher, held.value, groq());
    expect(held.takeQuota).not.toHaveBeenCalled();
  });

  it('accepts the guide’s own long replies in the conversation, but not long questions', async () => {
    const groq = scripted('groq', 'gpt-oss', ['Ok.']);
    const models = modelsOf(null, [groq.model]);
    const body = (reply: string) => ({
      action: 'chat',
      persona: 'teacher',
      language: 'en',
      messages: [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: reply },
        { role: 'user', text: 'And then?' },
      ],
    });
    expect(
      (await handleDisha(body('y'.repeat(4000)), teacher, services().value, models)).status,
    ).toBe(200);
    expect(
      (await handleDisha(body('y'.repeat(4001)), teacher, services().value, models)).status,
    ).toBe(400);
  });
});

describe('Disha: allowances survive unexpected failures', () => {
  it('gives the Claude request back when Claude fails in an unexpected way', async () => {
    const held = services();
    const claude = scripted('claude', 'claude-sonnet-5-5', []);
    claude.complete.mockImplementation(() => Promise.reject(new TypeError('boom')));
    const groq = scripted('groq', 'gpt-oss', ['Never.']);
    await expect(
      handleDisha(question(), teacher, held.value, modelsOf(claude.model, [groq.model])),
    ).rejects.toThrow('boom');
    expect(held.used.get('teacher-1:claude')).toBe(0);
    expect(held.used.get(`${PROJECT_ID}:claude`)).toBe(0);
  });

  it('gives the person’s Claude share back when the project’s count cannot be taken', async () => {
    const held = services();
    const original = held.takeQuota.getMockImplementation();
    held.takeQuota.mockImplementation((profileId: string, kind: string, limit: number) =>
      profileId === PROJECT_ID && kind === 'claude'
        ? Promise.reject(new Error('database is down'))
        : (original?.(profileId, kind, limit) ?? Promise.resolve(true)),
    );
    const claude = scripted('claude', 'claude-sonnet-5-5', ['Never.']);
    const groq = scripted('groq', 'gpt-oss', ['Never.']);
    await expect(
      handleDisha(question(), teacher, held.value, modelsOf(claude.model, [groq.model])),
    ).rejects.toThrow('database is down');
    expect(held.used.get('teacher-1:claude')).toBe(0);
  });
});
