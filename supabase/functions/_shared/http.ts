/**
 * Request parsing and response conventions shared by the Edge Functions.
 *
 * Every failure is answered as `{ "error": { "code": "...", "field": "..." } }`. Codes are stable
 * identifiers that the web application translates; messages are never shown to users directly.
 */

export type ErrorCode =
  | 'invalid_request'
  | 'forbidden'
  | 'not_found'
  | 'mobile_in_use'
  | 'invalid_scope'
  | 'student_not_verified'
  | 'cannot_change_self'
  | 'demonstration'
  | 'reauthentication_required'
  | 'weak_password'
  | 'invalid_credentials'
  | 'locked'
  | 'throttled'
  | 'busy'
  | 'concurrent_update'
  | 'method_not_allowed'
  | 'not_configured'
  | 'quota_exceeded'
  | 'ai_unavailable'
  | 'ai_refused'
  | 'internal_error';

export interface HandlerResult {
  status: number;
  body: unknown;
}

/**
 * The address of the network a request comes from. The platform's edge network sets
 * `CF-Connecting-IP` itself, so a caller cannot choose it; the first `X-Forwarded-For` address is
 * written by the caller and is used only where the other is missing. Empty when neither is present.
 */
export function networkAddressOf(headers: Headers): string {
  const connecting = (headers.get('cf-connecting-ip') ?? '').trim();
  if (connecting !== '') {
    return connecting;
  }
  return (headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
}

export function ok(body: unknown): HandlerResult {
  return { status: 200, body };
}

export function failure(
  status: number,
  code: ErrorCode,
  extra: Record<string, unknown> = {},
): HandlerResult {
  return { status, body: { error: { code, ...extra } } };
}

/** Raised while reading a request body; turned into a 400 response naming the field. */
export class RequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly field?: string,
  ) {
    super(field ? `${code}: ${field}` : code);
    this.name = 'RequestError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function readString(
  source: Record<string, unknown>,
  field: string,
  options: { maxLength: number; pattern?: RegExp },
): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RequestError('invalid_request', field);
  }
  const trimmed = value.trim();
  if (trimmed.length > options.maxLength || (options.pattern && !options.pattern.test(trimmed))) {
    throw new RequestError('invalid_request', field);
  }
  return trimmed;
}

export function readOptionalString(
  source: Record<string, unknown>,
  field: string,
  options: { maxLength: number; pattern?: RegExp },
): string | null {
  const value = source[field];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  return readString(source, field, options);
}

export function readUuid(source: Record<string, unknown>, field: string): string {
  return readString(source, field, { maxLength: 36, pattern: UUID_PATTERN }).toLowerCase();
}

export function readOptionalUuid(source: Record<string, unknown>, field: string): string | null {
  const value = readOptionalString(source, field, { maxLength: 36, pattern: UUID_PATTERN });
  return value ? value.toLowerCase() : null;
}

export function readBoolean(source: Record<string, unknown>, field: string): boolean {
  const value = source[field];
  if (typeof value !== 'boolean') {
    throw new RequestError('invalid_request', field);
  }
  return value;
}

export function readOneOf<const Options extends readonly string[]>(
  source: Record<string, unknown>,
  field: string,
  options: Options,
): Options[number] {
  const value = source[field];
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new RequestError('invalid_request', field);
  }
  return value;
}

/** Optional calendar date `YYYY-MM-DD` that must exist (2025-02-30 is rejected). */
export function readOptionalDate(source: Record<string, unknown>, field: string): string | null {
  const value = readOptionalString(source, field, { maxLength: 10, pattern: DATE_PATTERN });
  if (value === null) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RequestError('invalid_request', field);
  }
  return value;
}

export function readArray(
  source: Record<string, unknown>,
  field: string,
  bounds: { min: number; max: number },
): unknown[] {
  const value = source[field];
  if (!Array.isArray(value) || value.length < bounds.min || value.length > bounds.max) {
    throw new RequestError('invalid_request', field);
  }
  return value;
}

/** Runs a handler and turns request errors into 400 responses. */
export async function respondTo(work: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RequestError) {
      return failure(400, error.code, error.field ? { field: error.field } : {});
    }
    throw error;
  }
}
