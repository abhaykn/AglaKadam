import { failure, type HandlerResult, ok } from '../_shared/http.ts';
import type { RetentionKind, RetentionServices } from '../_shared/services.ts';

/** Recordings handled per round, and rounds per run; the rest waits for the next day. */
export const RETENTION_BATCH = 200;
export const RETENTION_ROUNDS = 10;

async function tidy(
  kind: RetentionKind,
  services: RetentionServices,
): Promise<{ expired: number; unclaimed: number }> {
  let expired = 0;
  let unclaimed = 0;
  for (let round = 0; round < RETENTION_ROUNDS; round += 1) {
    const due = await services.dueRecordings(kind, RETENTION_BATCH);
    if (due.length === 0) {
      break;
    }
    await services.removeFiles(
      kind,
      due.map((recording) => recording.path),
    );
    const expiredPaths = due
      .filter((recording) => recording.reason === 'expired')
      .map((recording) => recording.path);
    if (expiredPaths.length > 0) {
      await services.markRemoved(kind, expiredPaths);
    }
    expired += expiredPaths.length;
    unclaimed += due.length - expiredPaths.length;
  }
  return { expired, unclaimed };
}

/**
 * Deletes Pulse recordings past the 30-day listening window, and uploads that no check claimed;
 * then the same for the CRPs' voice notes of visits, whose transcripts go with them.
 *
 * Called once a day by the database's scheduler with the job token from Vault; any other caller is
 * refused. Files are deleted through the Storage API before the records are marked, so a failure
 * part-way leaves nothing marked as deleted that still exists; the next run picks up the rest.
 */
export async function handleRetention(
  token: string | null,
  services: RetentionServices,
): Promise<HandlerResult> {
  if (!token || !(await services.jobTokenIsValid(token))) {
    return failure(403, 'forbidden');
  }
  const pulse = await tidy('pulse', services);
  const notes = await tidy('notes', services);
  return ok({ ...pulse, notes });
}
