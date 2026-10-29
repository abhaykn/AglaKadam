import { withSupabase } from '../_shared/deps.ts';
import { ProviderBreaker } from '../_shared/failover.ts';
import { failure } from '../_shared/http.ts';
import { claudeModel, groqModel, type LanguageModel } from '../_shared/llm.ts';
import { loadCaller, readJsonBody, sahayakServices, serve } from '../_shared/platform.ts';
import { handleDisha, type DishaModels } from './handler.ts';

/**
 * The services' keys are the project's secrets (see the setup guide). Claude is asked first; Groq
 * answers when Claude cannot, so either key alone is enough. The models can be changed with
 * secrets of the same names, for example when a service retires one.
 */
function secret(name: string): string {
  return Deno.env.get(name)?.trim() ?? '';
}

function loadModels(): DishaModels {
  const groqKey = secret('GROQ_API_KEY');
  const claudeKey = secret('ANTHROPIC_API_KEY');
  const limit = Number.parseInt(secret('CLAUDE_DAILY_LIMIT') || '600', 10);
  const fetcher = (input: string, init: RequestInit) => fetch(input, init);
  const groq: LanguageModel[] = groqKey
    ? [
        groqModel(groqKey, secret('GROQ_TUTOR_MODEL') || 'openai/gpt-oss-120b', fetcher),
        // A second model has a limit of its own, so a busy first one does not stop the help.
        groqModel(groqKey, secret('GROQ_CHAT_MODEL') || 'llama-3.3-70b-versatile', fetcher),
      ]
    : [];
  return {
    claude: claudeKey
      ? claudeModel(claudeKey, secret('CLAUDE_MODEL') || 'claude-sonnet-5-5', fetcher)
      : null,
    groq,
    claudeDailyLimit: Number.isFinite(limit) && limit >= 0 ? limit : 600,
    breaker: new ProviderBreaker(),
  };
}

const models = loadModels();

export default {
  fetch: withSupabase({ auth: 'user' }, (req, ctx) =>
    serve('disha', req, async () => {
      const caller = await loadCaller(ctx.supabase);
      if (!caller) {
        return failure(403, 'forbidden');
      }
      return handleDisha(
        await readJsonBody(req),
        caller,
        sahayakServices(ctx.supabaseAdmin, ctx.supabase),
        models,
      );
    }),
  ),
};
