import { describe, expect, it } from 'vitest';
import { readEnvironment } from './env';

const valid = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnop_1234',
};

describe('readEnvironment', () => {
  it('reads a valid configuration and applies safe defaults', () => {
    expect(readEnvironment(valid)).toEqual({
      ok: true,
      value: {
        appEnvironment: 'development',
        demoWorkspaceEnabled: false,
        supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
        supabasePublishableKey: 'sb_publishable_abcdefghijklmnop_1234',
      },
    });
  });

  it('normalises a trailing slash and accepts a local development server', () => {
    const remote = readEnvironment({ ...valid, VITE_SUPABASE_URL: 'https://abcd.supabase.co/' });
    const local = readEnvironment({ ...valid, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(remote.ok && remote.value.supabaseUrl).toBe('https://abcd.supabase.co');
    expect(local.ok && local.value.supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('reports every problem together', () => {
    const result = readEnvironment({
      VITE_APP_ENV: 'prod',
      VITE_ENABLE_DEMO_WORKSPACE: 'yes',
      VITE_SUPABASE_URL: 'http://abcd.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abcdefghijklmnop',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toHaveLength(4);
  });

  it('requires the Supabase project URL and publishable key', () => {
    const result = readEnvironment({});
    expect(!result.ok && result.issues.join(' ')).toMatch(
      /VITE_SUPABASE_URL.*VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it('refuses a URL with a path, which would break every API call', () => {
    const result = readEnvironment({
      ...valid,
      VITE_SUPABASE_URL: 'https://abcd.supabase.co/rest/v1',
    });
    expect(result.ok).toBe(false);
  });
});
