import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database';
import { getEnv } from './env';
import { authStorage, SESSION_STORAGE_KEY } from './session-storage';

export { SESSION_STORAGE_KEY } from './session-storage';

export type AppSupabaseClient = SupabaseClient<Database>;

let client: AppSupabaseClient | null = null;

function create(autoRefreshToken: boolean): AppSupabaseClient {
  const { supabaseUrl, supabasePublishableKey } = getEnv();
  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      storage: authStorage,
      storageKey: SESSION_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken,
      detectSessionInUrl: false,
    },
  });
}

/**
 * The application's single Supabase client. It is created on first use, after the configuration
 * has been validated, so that a misconfigured deployment shows the configuration screen instead of
 * failing while modules load.
 */
export function getSupabase(): AppSupabaseClient {
  client ??= create(true);
  return client;
}

/**
 * A client for the service worker, which wakes only to send waiting changes. It shares the pages'
 * session; it refreshes the token when sending needs it, but runs no refresh timer of its own.
 */
export function createWorkerSupabase(): AppSupabaseClient {
  return create(false);
}

/**
 * A client that always sends `accessToken`, whatever happens to the stored session meanwhile, so
 * that changes are sent as the account that made them even if someone else signs in during a run.
 */
export function createClientForToken(accessToken: string | (() => string)): AppSupabaseClient {
  const { supabaseUrl, supabasePublishableKey } = getEnv();
  const token = typeof accessToken === 'string' ? () => accessToken : accessToken;
  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    accessToken: () => Promise.resolve(token()),
  });
}
