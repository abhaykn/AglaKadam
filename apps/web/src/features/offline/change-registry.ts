import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { z } from 'zod';
import type { AppSupabaseClient } from '@/lib/supabase';

/** What a handler is given to send a change, in a page or in the service worker. */
export interface ChangeContext {
  supabase: AppSupabaseClient;
  /** The decrypted contents of a file the change carries (see `files`). */
  readFile: (id: string) => Promise<Blob>;
}

/**
 * A kind of change that can be made without a network and sent later, for example saving a day's
 * attendance. Each kind describes how its saved data is checked, sent, shown and followed up.
 */
export interface ChangeHandler<Payload> {
  kind: string;
  /** Checks data read back from the device, which may have been saved by an older version. */
  schema: z.ZodType<Payload>;
  /**
   * Sends the change and returns what the server recorded. Throws the server's error, or a
   * `ChangeRejectedError`, when it is not accepted.
   */
  send: (payload: Payload, context: ChangeContext) => Promise<unknown>;
  /** How long a send may take before it counts as a lost connection (default 45 seconds). */
  timeoutMs?: number;
  /** Ids of the stored files (recordings) the change carries; removed once it has been sent. */
  files?: (payload: Payload) => string[];
  /**
   * Puts what the server recorded into the cache before the waiting change is removed, so the
   * screen never falls back to older data in between.
   */
  onSent?: (payload: Payload, result: unknown, queryClient: QueryClient) => void;
  /** Queries to refresh once the server has answered, whether it accepted the change or not. */
  invalidates: (payload: Payload) => QueryKey[];
  /** One line for the list of waiting changes, in the person's language (`en` or `hi`). */
  describe: (payload: Payload, t: TFunction, language: string) => string;
}

const handlers = new Map<string, ChangeHandler<unknown>>();

/** Registers a kind of change; registering the same kind again (as a reloaded module does) replaces it. */
export function registerChange<Payload>(handler: ChangeHandler<Payload>): ChangeHandler<Payload> {
  handlers.set(handler.kind, handler as ChangeHandler<unknown>);
  return handler;
}

export function changeHandler(kind: string): ChangeHandler<unknown> | undefined {
  return handlers.get(kind);
}
