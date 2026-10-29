import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { REPOSITORY_ROOT } from './environment.ts';

const require = createRequire(import.meta.url);
const CLI_ENTRY = require.resolve('supabase/dist/supabase.js');

export type Row = Record<string, unknown>;

/** Lines the CLI prints to standard error that are progress notes or hints, not the error itself. */
const CLI_NOISE = [/^Initialising login role/i, /^Try rerunning the command/i];

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rows from the CLI's JSON output. The CLI prints a plain array of rows in a terminal, and wraps the
 * same array as `{ "rows": [...] }` when it runs under some automation tools; both are accepted.
 * Returns null when the output is not JSON of either shape.
 */
export function parseRows(stdout: string): Row[] | null {
  const text = stdout.trim();
  const start = text.search(/[[{]/);
  if (start === -1) {
    return null;
  }
  let output: unknown;
  try {
    output = JSON.parse(text.slice(start));
  } catch {
    return null;
  }
  const rows: unknown = Array.isArray(output)
    ? output
    : isRow(output) && Array.isArray(output.rows)
      ? output.rows
      : null;
  return Array.isArray(rows) ? rows.filter(isRow) : null;
}

/** The error the CLI reported, from its JSON output or from standard error. */
export function cliErrorMessage(stdout: string, stderr: string): string {
  const start = stdout.indexOf('{');
  if (start !== -1) {
    try {
      const output: unknown = JSON.parse(stdout.slice(start));
      if (isRow(output) && isRow(output.error) && typeof output.error.message === 'string') {
        return output.error.message;
      }
    } catch {
      // Not JSON; standard error carries the message.
    }
  }
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !CLI_NOISE.some((pattern) => pattern.test(line)));
  return lines.join(' ') || 'The Supabase CLI reported an error without a message.';
}

/**
 * Runs SQL as the database owner through the Supabase CLI and the linked project's Management API
 * (HTTPS only). The CLI uses the developer's own `supabase login`; no key is involved. Returns the
 * rows of the statement that produces them.
 */
export function runSql(sql: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI_ENTRY, 'db', 'query', '--linked', '--output', 'json', sql],
      {
        cwd: REPOSITORY_ROOT,
        // The CLI uses the developer's own login; the project's secret key is never passed on.
        env: { ...process.env, SUPABASE_SECRET_KEY: undefined },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(cliErrorMessage(stdout, stderr)));
        return;
      }
      const rows = parseRows(stdout);
      if (rows === null) {
        reject(
          new Error(`The Supabase CLI answered in an unexpected format: ${stdout.slice(0, 200)}`),
        );
        return;
      }
      resolve(rows);
    });
  });
}
