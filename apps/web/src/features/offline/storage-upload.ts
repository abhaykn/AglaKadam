import { ChangeRejectedError, SessionUnavailableError } from './sync-errors';

/**
 * Errors of uploads to Storage in the terms the outbox understands, shared by the changes that
 * carry a recording.
 */

export interface StorageFailure {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
}

/** HTTP status of a Storage error; the service sometimes reports it only in the body. */
export function storageStatus(error: StorageFailure): number {
  const fromBody =
    typeof error.statusCode === 'string' ? Number.parseInt(error.statusCode, 10) : NaN;
  if (Number.isFinite(fromBody)) {
    return fromBody;
  }
  return typeof error.status === 'number' ? error.status : 0;
}

export function isAlreadyStored(error: StorageFailure): boolean {
  const message = typeof error.message === 'string' ? error.message : '';
  return (
    storageStatus(error) === 409 ||
    error.code === 'ResourceAlreadyExists' ||
    /already exists|duplicate/i.test(message)
  );
}

/** The upload failure in the terms the outbox understands: retry, sign in again, or refused. */
export function storageFailure(error: StorageFailure): Error {
  const message = typeof error.message === 'string' ? error.message : 'The upload failed.';
  const status = storageStatus(error);
  if (error.name !== 'StorageApiError' || status === 0) {
    // The request did not reach the service: no network, or the connection dropped.
    return Object.assign(new Error(message), { code: '' });
  }
  if (status === 401 || error.code === 'InvalidJWT') {
    return new SessionUnavailableError();
  }
  if (status === 408 || status === 429 || status >= 500) {
    return Object.assign(new Error(message), { code: 'storage_unavailable' });
  }
  return new ChangeRejectedError(`storage_${String(status)}`, message);
}
