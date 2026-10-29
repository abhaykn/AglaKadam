/**
 * Stores secrets of the linked Supabase project through the Supabase CLI. The values are written
 * only to a temporary file that the CLI reads and that is deleted at once, also when the command is
 * interrupted; they are never printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPOSITORY_ROOT } from './environment.ts';

const require = createRequire(import.meta.url);
const CLI_ENTRY = require.resolve('supabase/dist/supabase.js');

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/** The lines of an env file; a value may not span lines. */
export function envFile(secrets: Record<string, string>): string {
  return Object.entries(secrets)
    .map(([name, value]) => {
      if (!NAME.test(name) || /[\r\n]/.test(value) || value === '') {
        throw new Error(`Refusing to store an unexpected secret ${name}.`);
      }
      return `${name}=${value}\n`;
    })
    .join('');
}

export function storeSecrets(secrets: Record<string, string>, interruptedMessage: string): void {
  const content = envFile(secrets);
  const folder = mkdtempSync(join(tmpdir(), 'agla-secrets-'));
  const file = join(folder, 'secrets.env');
  const removeFolder = () => {
    rmSync(folder, { recursive: true, force: true });
  };
  // Ctrl+C reaches the Supabase CLI as well; the file is removed before this process ends.
  const interrupted = () => {
    removeFolder();
    console.log(`\n${interruptedMessage}`);
    process.exit(130);
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  process.once('exit', removeFolder);
  try {
    writeFileSync(file, content, { mode: 0o600 });
    const result = spawnSync(process.execPath, [CLI_ENTRY, 'secrets', 'set', '--env-file', file], {
      cwd: REPOSITORY_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(
        'The Supabase CLI could not store the secrets. Check `npx supabase login` and the link.',
      );
    }
  } finally {
    removeFolder();
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    process.off('exit', removeFolder);
  }
}
