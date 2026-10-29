import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

/**
 * Failure of an Edge Function call. `code` is the stable error code returned by the function
 * (see `supabase/functions/_shared/http.ts`), or `network` when the function could not be reached.
 */
export class FunctionCallError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`Edge Function call failed: ${code} (${String(status)})`);
    this.name = 'FunctionCallError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function callFunction<Result>(name: string, body: unknown): Promise<Result> {
  const response = await getSupabase().functions.invoke<Result>(name, {
    body: body as Record<string, unknown>,
  });

  if (!response.error) {
    return response.data as Result;
  }

  const error: unknown = response.error;
  if (error instanceof FunctionsHttpError) {
    const payload = await readJson(error.context as Response);
    const failure =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? (payload as { error: Record<string, unknown> }).error
        : {};
    const code = typeof failure.code === 'string' ? failure.code : 'internal_error';
    throw new FunctionCallError(code, (error.context as Response).status, failure);
  }

  if (error instanceof FunctionsFetchError) {
    throw new FunctionCallError('network', 0);
  }
  throw new FunctionCallError('internal_error', 0);
}
