import { todayInIndia } from '../_shared/accounts.ts';
import { withSupabase } from '../_shared/deps.ts';
import { failure } from '../_shared/http.ts';
import { claudeModel, groqModel } from '../_shared/llm.ts';
import { loadCaller, readJsonBody, sahayakServices, serve } from '../_shared/platform.ts';
import { handleSahayak, type SahayakModels } from './handler.ts';

/**
 * The services' keys, set as secrets of the project with `npm run ai:keys` (see the setup guide).
 * Without the Groq key nothing is offered; without the Claude key the rehearsal room uses Groq.
 * The models can be changed with secrets of the same names, for example when a service retires one.
 */
function secret(name: string): string {
  return Deno.env.get(name)?.trim() ?? '';
}

function loadModels(): SahayakModels {
  const groqKey = secret('GROQ_API_KEY');
  const claudeKey = secret('ANTHROPIC_API_KEY');
  const limit = Number.parseInt(secret('CLAUDE_DAILY_LIMIT') || '600', 10);
  const fetcher = (input: string, init: RequestInit) => fetch(input, init);
  return {
    text: groqKey
      ? groqModel(groqKey, secret('GROQ_TEXT_MODEL') || 'openai/gpt-oss-120b', fetcher)
      : null,
    vision: groqKey
      ? groqModel(groqKey, secret('GROQ_VISION_MODEL') || 'qwen/qwen3.8-27b', fetcher)
      : null,
    chat: groqKey
      ? groqModel(groqKey, secret('GROQ_CHAT_MODEL') || 'llama-3.3-70b-versatile', fetcher)
      : null,
    claude: claudeKey
      ? claudeModel(claudeKey, secret('CLAUDE_MODEL') || 'claude-sonnet-5-5', fetcher)
      : null,
    claudeDailyLimit: Number.isFinite(limit) && limit >= 0 ? limit : 600,
  };
}

const models = loadModels();

export default {
  fetch: withSupabase({ auth: 'user' }, (req, ctx) =>
    serve('sahayak', req, async () => {
      const caller = await loadCaller(ctx.supabase);
      if (!caller) {
        return failure(403, 'forbidden');
      }
      return handleSahayak(
        await readJsonBody(req),
        caller,
        sahayakServices(ctx.supabaseAdmin, ctx.supabase),
        models,
        todayInIndia(),
      );
    }),
  ),
};
