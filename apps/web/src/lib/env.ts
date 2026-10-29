/**
 * Validated, typed view of the build-time environment.
 *
 * Validation is hand-written rather than schema-based so that it adds no weight to the first
 * download. Every problem is collected and reported together; the application shows a configuration
 * screen instead of starting with an invalid configuration and failing later in an unexpected place.
 */

const appEnvironments = ['development', 'staging', 'production'] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

export interface Environment {
  appEnvironment: AppEnvironment;
  demoWorkspaceEnabled: boolean;
  /** Project URL without a trailing slash, for example `https://abcd.supabase.co`. */
  supabaseUrl: string;
  /** Publishable key (`sb_publishable_...`); safe to ship to browsers, protected by row level security. */
  supabasePublishableKey: string;
}

export type EnvironmentResult = { ok: true; value: Environment } | { ok: false; issues: string[] };

interface EnvironmentSource {
  VITE_APP_ENV?: string;
  VITE_ENABLE_DEMO_WORKSPACE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export class ConfigurationError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid runtime configuration. ${issues.join('; ')}`);
    this.name = 'ConfigurationError';
  }
}

const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{10,}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function readEnvironment(source: EnvironmentSource): EnvironmentResult {
  const issues: string[] = [];

  const readChoice = <T extends string>(
    name: string,
    raw: string | undefined,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    if (raw === undefined || raw === '') {
      return fallback;
    }
    const match = allowed.find((option) => option === raw);
    if (match === undefined) {
      issues.push(`${name} must be one of ${allowed.join(', ')} (received "${raw}")`);
      return fallback;
    }
    return match;
  };

  const appEnvironment = readChoice(
    'VITE_APP_ENV',
    source.VITE_APP_ENV,
    appEnvironments,
    'development',
  );
  const demoWorkspaceEnabled =
    readChoice(
      'VITE_ENABLE_DEMO_WORKSPACE',
      source.VITE_ENABLE_DEMO_WORKSPACE,
      ['true', 'false'],
      'false',
    ) === 'true';

  let supabaseUrl = '';
  const rawUrl = source.VITE_SUPABASE_URL?.trim() ?? '';
  if (rawUrl === '') {
    issues.push('VITE_SUPABASE_URL is required (Project Settings → API Keys in the dashboard)');
  } else {
    try {
      const url = new URL(rawUrl);
      const secure = url.protocol === 'https:';
      const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
      if ((!secure && !local) || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
        issues.push(
          'VITE_SUPABASE_URL must be the project URL, for example https://abcd.supabase.co',
        );
      } else {
        supabaseUrl = url.origin;
      }
    } catch {
      issues.push('VITE_SUPABASE_URL is not a valid URL');
    }
  }

  const supabasePublishableKey = source.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (supabasePublishableKey === '') {
    issues.push('VITE_SUPABASE_PUBLISHABLE_KEY is required (Project Settings → API Keys)');
  } else if (!PUBLISHABLE_KEY_PATTERN.test(supabasePublishableKey)) {
    issues.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key starting with sb_publishable_ (never a secret key)',
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: { appEnvironment, demoWorkspaceEnabled, supabaseUrl, supabasePublishableKey },
  };
}

const result = readEnvironment(import.meta.env);

/** Problems with the current configuration; empty when the application can start. */
export const configurationIssues: readonly string[] = result.ok ? [] : result.issues;

/** The validated configuration. Only call once {@link configurationIssues} is known to be empty. */
export function getEnv(): Environment {
  if (!result.ok) {
    throw new ConfigurationError(result.issues);
  }
  return result.value;
}
