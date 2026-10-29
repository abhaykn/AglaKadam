import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the repository, which holds `apps/web` and the linked `supabase` folder. */
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface Environment {
  projectRef: string;
  supabaseUrl: string;
  publishableKey: string;
}

const HOSTED_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const PUBLISHABLE_KEY = /^sb_publishable_\S{16,}$/;
const SECRET_KEY = /^sb_secret_\S{16,}$/;

const CONTROL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(8);
const DELETE = String.fromCharCode(127);

function parseEnvironmentFile(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] && match[2] !== undefined) {
      values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return values;
}

async function readText(relativePath: string, missingMessage: string): Promise<string> {
  try {
    return await readFile(join(REPOSITORY_ROOT, relativePath), 'utf8');
  } catch {
    throw new Error(missingMessage);
  }
}

/**
 * Reads the project the web app is configured for (`apps/web/.env.local`) and makes sure the
 * Supabase CLI is linked to the same project, because the CLI removes the test records afterwards.
 */
export async function readEnvironment(): Promise<Environment> {
  const values = parseEnvironmentFile(
    await readText(
      'apps/web/.env.local',
      'apps/web/.env.local was not found. Create it as described in the setup guide (3.4).',
    ),
  );
  const supabaseUrl = values.get('VITE_SUPABASE_URL') ?? '';
  const publishableKey = values.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  const urlMatch = HOSTED_URL.exec(supabaseUrl);
  if (!urlMatch?.[1]) {
    throw new Error(
      'VITE_SUPABASE_URL in apps/web/.env.local is not a hosted Supabase project URL.',
    );
  }
  if (!PUBLISHABLE_KEY.test(publishableKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local is not a publishable key.',
    );
  }

  const linkedRef = (
    await readText(
      'supabase/.temp/project-ref',
      'The Supabase CLI is not linked to a project. Run "npx supabase link" first.',
    )
  ).trim();
  if (linkedRef !== urlMatch[1]) {
    throw new Error(
      `The Supabase CLI is linked to "${linkedRef}", but the web app uses "${urlMatch[1]}". ` +
        'Link the CLI to the same project before running the check.',
    );
  }

  return { projectRef: urlMatch[1], supabaseUrl: supabaseUrl.replace(/\/$/, ''), publishableKey };
}

/** What a hidden prompt says when it cannot ask, and when it is cancelled. */
export interface HiddenPromptMessages {
  noTerminal: string;
  cancelled: string;
}

const CHECK_MESSAGES: HiddenPromptMessages = {
  noTerminal: 'Run the check in an interactive terminal, or set SUPABASE_SECRET_KEY for it.',
  cancelled: 'Cancelled. Nothing was created.',
};

export function promptHidden(
  question: string,
  messages: HiddenPromptMessages = CHECK_MESSAGES,
): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return Promise.reject(new Error(messages.noTerminal));
  }
  stdout.write(question);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error: Error | null) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value.trim());
      }
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          finish(null);
          return;
        }
        if (character === CONTROL_C) {
          finish(new Error(messages.cancelled));
          return;
        }
        if (character === BACKSPACE || character === DELETE) {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/**
 * The project's secret key, typed or pasted without being shown, or taken from
 * `SUPABASE_SECRET_KEY`. It is kept in memory only and never printed or written anywhere.
 */
export async function readSecretKey(): Promise<string> {
  const fromEnvironment = process.env.SUPABASE_SECRET_KEY?.trim();
  const key =
    fromEnvironment !== undefined && fromEnvironment !== ''
      ? fromEnvironment
      : await promptHidden('Secret key (sb_secret_..., input hidden): ');
  if (!SECRET_KEY.test(key)) {
    throw new Error('That is not a secret key. It starts with "sb_secret_". Nothing was created.');
  }
  return key;
}
