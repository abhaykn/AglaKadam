// Runs the Deno CLI for the Edge Functions. Deno would otherwise pick up the repository's npm
// workspace (package.json) and try to resolve the web application's dependencies; the functions
// declare their own pinned `npm:` imports instead.
import { spawnSync } from 'node:child_process';

const result = spawnSync('deno', process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' },
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
