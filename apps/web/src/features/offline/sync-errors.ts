import { FunctionCallError } from '@/lib/functions';

/**
 * What to do after a change could not be sent:
 * - `retry`: the network or the server had a temporary problem; send again later.
 * - `reauthenticate`: the session token was not accepted; send again once it has been refreshed.
 * - `reject`: the server refused the change itself (for example no permission any more, or a date
 *   outside the allowed window); sending it again would fail the same way, so the person decides.
 */
export type FailureKind = 'retry' | 'reauthenticate' | 'reject';

export interface ClassifiedFailure {
  kind: FailureKind;
  code: string;
  message: string;
}

/**
 * Thrown by a change handler when the server's data shows that the change must not be applied as
 * it stands, for example because someone else changed the same record after the person started.
 */
export class ChangeRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChangeRejectedError';
    this.code = code;
  }
}

/** Thrown when there is no valid session to send with; sending resumes after sign-in or refresh. */
export class SessionUnavailableError extends Error {
  readonly code = 'session';

  constructor() {
    super('There is no valid session to send changes with.');
    this.name = 'SessionUnavailableError';
  }
}

/** Database errors that will not go away by trying again. */
const REJECTED_SQLSTATE_CLASSES = ['22', '23', '42', 'P0'];
/** Database errors caused by load or by a lost connection, which are worth retrying. */
const TEMPORARY_SQLSTATES = new Set(['40001', '40P01', '55P03', '57014', '57P01']);
const TEMPORARY_SQLSTATE_CLASSES = ['08', '53', '54', '58'];

function textOf(error: unknown): { code: string; message: string } {
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : 'Unknown error';
    return { code, message };
  }
  return { code: '', message: String(error) };
}

/**
 * The failure as an `Error`, keeping its code and message. Services report failures as plain
 * objects (`{ code, message }`); dropping the code would turn a refusal into a retry.
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  const { code, message } = textOf(error);
  return Object.assign(new Error(message), { code });
}

export function classifyFailure(error: unknown): ClassifiedFailure {
  if (error instanceof ChangeRejectedError) {
    return { kind: 'reject', code: error.code, message: error.message };
  }
  if (error instanceof SessionUnavailableError) {
    return { kind: 'reauthenticate', code: error.code, message: error.message };
  }
  if (error instanceof FunctionCallError) {
    const message = error.message;
    if (error.code === 'network' || error.status === 0 || error.status >= 500) {
      return { kind: 'retry', code: error.code, message };
    }
    if (error.status === 401) {
      return { kind: 'reauthenticate', code: error.code, message };
    }
    if (error.status === 408 || error.status === 429) {
      return { kind: 'retry', code: error.code, message };
    }
    return { kind: 'reject', code: error.code, message };
  }

  const { code, message } = textOf(error);
  if (code === '') {
    // No code at all: the request did not reach the database (offline, DNS, timeout).
    return { kind: 'retry', code: 'network', message };
  }
  if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') {
    return { kind: 'reauthenticate', code, message };
  }
  if (code.startsWith('PGRST')) {
    // Malformed requests and schema mismatches: retrying the same request cannot succeed.
    return { kind: 'reject', code, message };
  }
  if (TEMPORARY_SQLSTATES.has(code) || TEMPORARY_SQLSTATE_CLASSES.includes(code.slice(0, 2))) {
    return { kind: 'retry', code, message };
  }
  if (REJECTED_SQLSTATE_CLASSES.includes(code.slice(0, 2))) {
    return { kind: 'reject', code, message };
  }
  return { kind: 'retry', code, message };
}

const FIRST_RETRY_MS = 15_000;
const LONGEST_RETRY_MS = 30 * 60_000;

/**
 * Delay before the next attempt: 15 seconds, doubling up to 30 minutes, with ±20% spread so that
 * many devices coming back online together do not all retry at the same moment.
 */
export function retryDelay(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1), LONGEST_RETRY_MS);
  return Math.round(base * (0.8 + random() * 0.4));
}
