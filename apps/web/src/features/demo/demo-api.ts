import { queryOptions } from '@tanstack/react-query';
import { callFunction, FunctionCallError } from '@/lib/functions';
import { getSupabase } from '@/lib/supabase';

/**
 * Demonstration districts: a visitor picks a role and the `demo` function builds a district of
 * their own, then answers with a one-time token that this device exchanges for its own session.
 * Everything in the district is simulated, and the application says so on every screen.
 */

export const DEMO_ROLES = ['teacher', 'crp', 'officer', 'family'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export function isDemoRole(value: unknown): value is DemoRole {
  return DEMO_ROLES.some((role) => role === value);
}

export interface MyDemo {
  role: DemoRole;
  expiresAt: string;
  school: string;
  schoolHi: string | null;
  /** The person of each role in this district. */
  people: Partial<Record<DemoRole, string>>;
}

/** The caller's demonstration district, read from what the database returns; null otherwise. */
export function toMyDemo(data: unknown): MyDemo | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const body = data as Record<string, unknown>;
  if (!isDemoRole(body.role) || typeof body.expires_at !== 'string') {
    return null;
  }
  const people: Partial<Record<DemoRole, string>> = {};
  if (typeof body.people === 'object' && body.people !== null) {
    for (const [role, name] of Object.entries(body.people as Record<string, unknown>)) {
      if (isDemoRole(role) && typeof name === 'string') {
        people[role] = name;
      }
    }
  }
  return {
    role: body.role,
    expiresAt: body.expires_at,
    school: typeof body.school === 'string' ? body.school : '',
    schoolHi: typeof body.school_hi === 'string' ? body.school_hi : null,
    people,
  };
}

export const myDemoKey = () => ['my-demo'] as const;

export function myDemoQuery() {
  return queryOptions({
    queryKey: myDemoKey(),
    meta: { persist: true },
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MyDemo | null> => {
      const { data, error } = await getSupabase().rpc('my_demo');
      if (error) {
        throw error;
      }
      return toMyDemo(data);
    },
  });
}

export type DemoFailure = 'busy' | 'throttled' | 'network' | 'unavailable' | 'ended' | 'unexpected';

export class DemoError extends Error {
  constructor(
    readonly reason: DemoFailure,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`The demonstration could not open: ${reason}`);
    this.name = 'DemoError';
  }
}

function toDemoError(error: unknown): DemoError {
  if (error instanceof FunctionCallError) {
    if (error.code === 'busy') {
      return new DemoError('busy');
    }
    if (error.code === 'throttled') {
      const seconds = error.details.retry_after_seconds;
      return new DemoError('throttled', typeof seconds === 'number' ? seconds : null);
    }
    if (error.code === 'network') {
      return new DemoError('network');
    }
    if (error.code === 'not_configured') {
      return new DemoError('unavailable');
    }
    // The district has ended (or was never this session's): there is nothing to switch to.
    if (error.code === 'forbidden' || error.code === 'not_found') {
      return new DemoError('ended');
    }
  }
  return new DemoError('unexpected');
}

async function tokenFor(body: Record<string, unknown>): Promise<string> {
  try {
    const result = await callFunction<{ token_hash: string }>('demo', body);
    return result.token_hash;
  } catch (error) {
    throw toDemoError(error);
  }
}

/** Signs this device in with a one-time token from the `demo` function. */
export async function signInWithDemoToken(tokenHash: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (error) {
    throw new DemoError('unexpected');
  }
}

/** Builds a district for the visitor and returns the token of the role chosen. */
export function startDemo(role: DemoRole, language: 'hi' | 'en'): Promise<string> {
  return tokenFor({ action: 'start', role, language });
}

/** The token of another role of the signed-in visitor's own district. */
export function switchDemoRole(role: DemoRole): Promise<string> {
  return tokenFor({ action: 'switch', role });
}
