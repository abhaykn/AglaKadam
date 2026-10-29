/**
 * Stores the keys of the language-model services as secrets of the linked project, where the
 * `sahayak` Edge Function reads them.
 *
 *   npm run ai:keys
 *
 * The Groq key is needed for Sahayak at all; the Claude key is optional and only used by the
 * rehearsal room, which falls back to Groq without it. Keys are typed without being shown, and
 * stored as `secrets.ts` stores every secret. A key left empty is not changed.
 */
import { createInterface } from 'node:readline/promises';
import { promptHidden } from './environment.ts';
import { storeSecrets } from './secrets.ts';

const GROQ_KEY = /^gsk_[A-Za-z0-9]{20,200}$/;
const MESSAGES = {
  noTerminal: 'Run `npm run ai:keys` in an interactive terminal, so that the keys stay hidden.',
  cancelled: 'Cancelled. Nothing was changed.',
};
const CLAUDE_KEY = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

/** The secrets to store from what was typed; throws for a value that is not a key of its service. */
export function aiSecrets(groq: string, claude: string): Record<string, string> {
  const secrets: Record<string, string> = {};
  const groqKey = groq.trim();
  const claudeKey = claude.trim();
  if (groqKey) {
    if (!GROQ_KEY.test(groqKey)) {
      throw new Error('That is not a Groq key; it starts with "gsk_". Nothing was changed.');
    }
    secrets.GROQ_API_KEY = groqKey;
  }
  if (claudeKey) {
    if (!CLAUDE_KEY.test(claudeKey)) {
      throw new Error('That is not a Claude key; it starts with "sk-ant-". Nothing was changed.');
    }
    secrets.ANTHROPIC_API_KEY = claudeKey;
  }
  return secrets;
}

/** Asks for the keys, then stores those given. */
export async function storeAiKeys(): Promise<void> {
  console.log(
    'This stores the keys Sahayak uses in the linked Supabase project. Typing is not shown.\n' +
      'Press Enter without typing to leave a key as it is.\n',
  );
  const groq = await promptHidden(
    'Groq API key (gsk_..., for drafts, scores and orders): ',
    MESSAGES,
  );
  const claude = await promptHidden(
    'Claude API key (sk-ant-..., optional, rehearsal room): ',
    MESSAGES,
  );
  const secrets = aiSecrets(groq, claude);
  if (Object.keys(secrets).length === 0) {
    console.log('No key was typed. Nothing was changed.');
    return;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `Store ${Object.keys(secrets).join(' and ')} in the linked project now? (y/N) `,
    );
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Nothing was changed.');
      return;
    }
  } finally {
    prompt.close();
  }
  storeSecrets(secrets, 'Interrupted. The keys may not have been stored; run the command again.');
  console.log('\nThe keys are stored. Sahayak uses them from its next start; nothing to redeploy.');
}
