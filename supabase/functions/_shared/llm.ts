/**
 * Calls to the language-model services, behind one interface: Groq (free tier, open models) for
 * the everyday help, and Claude for the rehearsal room while its credit lasts. Keys come from the
 * project's secrets; nothing here logs a prompt or an answer.
 *
 * Answers that must be data are requested against a JSON schema that both services enforce
 * (strict structured outputs), and are checked again by the handler before use.
 */

export type ProviderName = 'groq' | 'claude';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  turns: ChatTurn[];
  /** A picture sent with the last user turn. */
  image?: { mediaType: string; base64: string };
  schema?: JsonSchema;
  maxTokens: number;
  /** How much the model may think: a short reply in a conversation needs little. */
  effort: 'low' | 'medium';
}

export interface Completion {
  text: string;
  model: string;
  provider: ProviderName;
}

/**
 * Why a service did not answer:
 *   * `not_configured`  no key is set for it;
 *   * `exhausted`       the credit or the plan is used up: no use asking again today;
 *   * `busy`            a passing rate limit: worth asking again in a minute;
 *   * `unavailable`     the service failed or timed out, worth trying again later;
 *   * `rejected`        the service turned the request down before generating anything;
 *   * `refused`         the model declined, or its answer was cut off or not the data asked for.
 */
export type CompletionFailure =
  'not_configured' | 'exhausted' | 'busy' | 'unavailable' | 'rejected' | 'refused';

/**
 * Whether the service generated an answer before failing, so that the request cost what an answered
 * one costs. Only `refused` is such a failure.
 */
export function wasGenerated(error: CompletionError): boolean {
  return error.reason === 'refused';
}

export class CompletionError extends Error {
  constructor(
    readonly reason: CompletionFailure,
    readonly provider: ProviderName,
    detail: string,
  ) {
    super(`${provider}: ${reason} (${detail})`);
    this.name = 'CompletionError';
  }
}

export interface LanguageModel {
  readonly provider: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<Completion>;
}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** A service's answer may take a while on a slow day; the function's own limit is far above. */
const TIMEOUT_MS = 45_000;

async function post(
  provider: ProviderName,
  fetcher: Fetcher,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (error) {
    throw new CompletionError(
      'unavailable',
      provider,
      error instanceof Error ? error.name : 'request failed',
    );
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Reported below by status.
  }
  if (!response.ok) {
    throw new CompletionError(
      failureFor(provider, response.status, text),
      provider,
      `HTTP ${String(response.status)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CompletionError('unavailable', provider, 'unreadable answer');
  }
  return parsed as Record<string, unknown>;
}

/** What an HTTP failure of a service means for the caller. */
export function failureFor(
  provider: ProviderName,
  status: number,
  body: string,
): CompletionFailure {
  if (status === 401 || status === 403) {
    // A key that was removed or revoked: the service is as good as not set up.
    return 'not_configured';
  }
  if (status === 402) {
    return 'exhausted';
  }
  if (provider === 'claude' && status === 400 && /credit balance|billing/i.test(body)) {
    return 'exhausted';
  }
  // Groq answers a request over its tokens-per-minute limit with 413 as well as 429.
  if (
    status === 429 ||
    status === 529 ||
    (status === 413 && /rate.?limit|per minute/i.test(body))
  ) {
    return 'busy';
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return 'rejected';
  }
  return 'unavailable';
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Groq's OpenAI-compatible chat completions. */
export function groqModel(apiKey: string, model: string, fetcher: Fetcher): LanguageModel {
  return {
    provider: 'groq',
    model,
    async complete(request) {
      if (!apiKey) {
        throw new CompletionError('not_configured', 'groq', 'no key');
      }
      const turns = request.turns.map((turn, index) => {
        const last = index === request.turns.length - 1;
        if (last && request.image && turn.role === 'user') {
          // Vision models take the instructions with the picture, in the same message.
          return {
            role: 'user',
            content: [
              { type: 'text', text: `${request.system}\n\n${turn.content}` },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${request.image.mediaType};base64,${request.image.base64}`,
                },
              },
            ],
          };
        }
        return { role: turn.role, content: turn.content };
      });
      const body: Record<string, unknown> = {
        model,
        messages: request.image ? turns : [{ role: 'system', content: request.system }, ...turns],
        max_completion_tokens: request.maxTokens,
        temperature: request.schema ? 0.3 : 0.8,
      };
      // Models that think first are told how much; the others do not take the setting.
      if (model.startsWith('openai/gpt-oss')) {
        body.reasoning_effort = request.effort;
      } else if (model.startsWith('qwen/')) {
        body.reasoning_effort = 'none';
      }
      if (request.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema },
        };
      }
      const answer = await post(
        'groq',
        fetcher,
        'https://api.groq.com/openai/v1/chat/completions',
        {
          authorization: `Bearer ${apiKey}`,
        },
        body,
      );
      const choices = Array.isArray(answer.choices) ? answer.choices : [];
      const first = choices[0] as
        { message?: { content?: unknown }; finish_reason?: unknown } | undefined;
      const text = readText(first?.message?.content).trim();
      if (first?.finish_reason === 'length' || text === '') {
        throw new CompletionError('refused', 'groq', `finish ${String(first?.finish_reason)}`);
      }
      return { text, model: readText(answer.model) || model, provider: 'groq' };
    },
  };
}

/** Anthropic's Messages API. */
export function claudeModel(apiKey: string, model: string, fetcher: Fetcher): LanguageModel {
  return {
    provider: 'claude',
    model,
    async complete(request) {
      if (!apiKey) {
        throw new CompletionError('not_configured', 'claude', 'no key');
      }
      const messages = request.turns.map((turn, index) => {
        const last = index === request.turns.length - 1;
        if (last && request.image && turn.role === 'user') {
          return {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: request.image.mediaType,
                  data: request.image.base64,
                },
              },
              { type: 'text', text: turn.content },
            ],
          };
        }
        return { role: turn.role, content: turn.content };
      });
      const outputConfig: Record<string, unknown> = { effort: request.effort };
      if (request.schema) {
        outputConfig.format = { type: 'json_schema', schema: request.schema.schema };
      }
      const body: Record<string, unknown> = {
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages,
        output_config: outputConfig,
      };
      // A reply in a conversation is spoken at once, without thinking ahead first. Only this
      // model takes the setting; others think as little as the low effort lets them.
      if (!request.schema && request.effort === 'low' && model.startsWith('claude-sonnet-5-5')) {
        body.thinking = { type: 'between_tools' };
      }
      const answer = await post(
        'claude',
        fetcher,
        'https://api.anthropic.com/v1/messages',
        {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      );
      const blocks = Array.isArray(answer.content) ? answer.content : [];
      const text = blocks
        .filter(
          (block): block is { type: string; text: string } =>
            typeof block === 'object' &&
            block !== null &&
            (block as { type?: unknown }).type === 'text',
        )
        .map((block) => readText(block.text))
        .join('')
        .trim();
      if (answer.stop_reason === 'refusal' || answer.stop_reason === 'max_tokens' || text === '') {
        throw new CompletionError('refused', 'claude', `stop ${String(answer.stop_reason)}`);
      }
      return { text, model: readText(answer.model) || model, provider: 'claude' };
    },
  };
}

/** Parses an answer that must be a JSON object. */
export function parseObject(completion: Completion): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(completion.text);
  } catch {
    throw new CompletionError('refused', completion.provider, 'not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompletionError('refused', completion.provider, 'not an object');
  }
  return value as Record<string, unknown>;
}
