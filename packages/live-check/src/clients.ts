import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../apps/web/src/lib/database.ts';
import type { Environment } from './environment.ts';
import { CheckFailure, expect } from './report.ts';

export type Client = SupabaseClient<Database>;

export interface FunctionResult {
  status: number;
  body: Record<string, unknown>;
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  expect(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${what} did not return an object.`,
  );
  return value as Record<string, unknown>;
}

export function errorCodeOf(result: FunctionResult): string {
  const error = result.body.error;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return 'no error code';
}

/** Seconds the function asked to wait before asking again, when it said so. */
export function retryAfterOf(result: FunctionResult): number | null {
  const error = result.body.error;
  if (typeof error === 'object' && error !== null && 'retry_after_seconds' in error) {
    const seconds = error.retry_after_seconds;
    if (typeof seconds === 'number') {
      return seconds;
    }
  }
  return null;
}

/**
 * Why Sahayak could not reach a language-model service, read from the wait it asks for: the
 * function answers 60 s for a rate limit, 20 s for a failure or time-out, and an hour when the
 * day's allowance is used up.
 */
export function aiUnavailableReason(result: FunctionResult): string | null {
  if (result.status !== 503 || errorCodeOf(result) !== 'ai_unavailable') {
    return null;
  }
  const seconds = retryAfterOf(result);
  if (seconds !== null && seconds >= 3600) {
    return "the service's allowance or credit is used up for now";
  }
  if (seconds === 60) {
    return 'the service is limiting requests (a passing rate limit)';
  }
  return 'the service failed or did not answer in time';
}

export function answered(result: FunctionResult): string {
  const reason = aiUnavailableReason(result);
  return `${result.status} (${result.status === 200 ? 'ok' : errorCodeOf(result)}${reason ? `: ${reason}` : ''})`;
}

/**
 * Connections to the project as the web app makes them: a visitor with the publishable key,
 * password sign-in, and the Edge Functions. The service client (secret key) is used only where the
 * first administrator of a project cannot be created any other way, and to tidy up.
 */
export function connections(environment: Environment, secretKey: string) {
  const newClient = (key: string): Client =>
    createClient<Database>(environment.supabaseUrl, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  const signIn = async (email: string, password: string): Promise<Client> => {
    const client = newClient(environment.publishableKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new CheckFailure(`Sign-in was refused (${error.code ?? error.message}).`);
    }
    return client;
  };

  const invoke = async (
    client: Client,
    name: string,
    body: Record<string, unknown>,
  ): Promise<FunctionResult> => {
    const outcome = await client.functions.invoke<unknown>(name, { body });
    const error: unknown = outcome.error;
    if (!error) {
      return { status: 200, body: asRecord(outcome.data, name) };
    }
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      const payload: unknown = await response.json().catch(() => null);
      return {
        status: response.status,
        body:
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : {},
      };
    }
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new CheckFailure(`The ${name} function could not be reached: ${reason}`);
  };

  /**
   * A request that a language-model service answers. A service that is briefly busy or failing is
   * asked once more, after the wait the function names (at most a minute), as the app's own retry
   * would.
   */
  const invokeAi = async (
    client: Client,
    name: string,
    body: Record<string, unknown>,
    wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ): Promise<FunctionResult> => {
    const first = await invoke(client, name, body);
    const seconds = retryAfterOf(first);
    if (aiUnavailableReason(first) === null || seconds === null || seconds > 60) {
      return first;
    }
    await wait(seconds * 1000);
    return invoke(client, name, body);
  };

  return {
    newClient,
    visitor: newClient(environment.publishableKey),
    service: newClient(secretKey),
    signIn,
    invoke,
    invokeAi,
  };
}
