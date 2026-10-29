import { DEMO_EMAIL_DOMAIN } from '../_shared/accounts.ts';
import {
  failure,
  type HandlerResult,
  isRecord,
  ok,
  readOneOf,
  RequestError,
  respondTo,
} from '../_shared/http.ts';
import {
  DEMO_ROLES,
  type DemoPerson,
  type DemoPlaces,
  type DemoRole,
  type DemoServices,
} from '../_shared/services.ts';
import type { DemoRecording } from './recordings.ts';

/**
 * Demonstration districts: anyone may try the application in a district of their own, as a
 * teacher, a CRP, a block education officer or a family, without an account.
 *
 * `start` builds the district in the database's steps (see the `demo` migration), creating its four
 * accounts through the Auth service in between, and answers with a one-time token for the role
 * chosen; the visitor's device exchanges it for its own session, as a family's device does. `switch`
 * gives a signed-in visitor the token of another role of the same district. `sweep`, called by the
 * database with the job token, removes the districts that have expired.
 *
 * Every identity is recorded in the database the moment it exists, and removing a district lists its
 * identities to be deleted before its data goes; the sweep works through that list first. So an
 * identity is never left behind, even when building or removing stops half-way.
 */

/** The history, written in this order after the accounts exist. */
export const HISTORY_STEPS = [
  'attendance',
  'draws',
  'pulse',
  'coaching',
  'exams',
  'notes',
] as const;

/** Background staff created at once, so that the first visitor does not wait for each in turn. */
const CREATE_AT_ONCE = 8;

/** Identities deleted in one go: those of a few districts, within the function's time. */
const DELETE_AT_ONCE = 60;

export interface RecordingSource {
  list: readonly DemoRecording[];
  bytes(key: string): Promise<Uint8Array>;
}

const STAFF_ROLE: Record<Exclude<DemoPerson['role'], 'family'>, string> = {
  teacher: 'teacher',
  crp: 'crp',
  officer: 'block_officer',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function personFrom(value: unknown): DemoPerson | null {
  if (!isRecord(value)) {
    return null;
  }
  const role = value.role;
  if (role !== 'teacher' && role !== 'crp' && role !== 'officer' && role !== 'family') {
    return null;
  }
  return {
    role,
    fullName: text(value.full_name),
    scope: text(value.scope),
    student: text(value.student),
    slot: text(value.slot),
  };
}

/** What the `places` step asks the function to create. */
export function placesFrom(result: Record<string, unknown>): DemoPlaces {
  const postedOn = text(result.posted_on);
  const accounts = Array.isArray(result.accounts) ? result.accounts.map(personFrom) : [];
  const staff = Array.isArray(result.staff) ? result.staff.map(personFrom) : [];
  if (
    !postedOn ||
    accounts.length !== DEMO_ROLES.length ||
    accounts.includes(null) ||
    staff.includes(null)
  ) {
    throw new Error('The district did not say which accounts it needs.');
  }
  return {
    postedOn,
    accounts: accounts as DemoPerson[],
    staff: staff as DemoPerson[],
  };
}

/** What the Auth service stores for an account, for the database to provision it from. */
export function provisioningOf(
  person: DemoPerson,
  postedOn: string,
  language: 'hi' | 'en',
): Record<string, unknown> {
  if (person.role === 'family') {
    return {
      provisioning: {
        account_kind: 'student',
        student_id: person.student,
        preferred_language: language,
      },
    };
  }
  return {
    provisioning: {
      account_kind: 'staff',
      full_name: person.fullName,
      preferred_language: language,
      // Nobody signs in to these accounts with a password.
      password_change_required: false,
      assignment: { role: STAFF_ROLE[person.role], scope_id: person.scope, starts_on: postedOn },
    },
  };
}

export function demoEmail(name: string, sandbox: string): string {
  return `${name}.${sandbox}@${DEMO_EMAIL_DOMAIN}`;
}

async function inBatches<Item, Result>(
  items: readonly Item[],
  size: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  }
  return results;
}

/** The sample recordings as the `finish` step takes them. */
function recordingDetails(recordings: readonly DemoRecording[]) {
  return recordings.map((recording) => ({
    key: recording.key,
    type: recording.type,
    grade: recording.grade,
    item_code: recording.itemCode,
    prompt_code: recording.promptCode,
    duration_ms: recording.durationMs,
    bytes: recording.bytes,
    teacher_reading: recording.teacherReading,
    teacher_english: recording.teacherEnglish,
    shown: recording.shown,
    score: recording.score,
  }));
}

function readLanguage(body: Record<string, unknown>): 'hi' | 'en' {
  return body.language === undefined ? 'hi' : readOneOf(body, 'language', ['hi', 'en'] as const);
}

async function build(
  services: DemoServices,
  sandbox: string,
  role: DemoRole,
  language: 'hi' | 'en',
  recordings: RecordingSource,
): Promise<string> {
  const places = placesFrom(await services.build(sandbox, 'places'));
  try {
    const staff: Record<string, string> = {};
    await inBatches(places.staff, CREATE_AT_ONCE, async (person) => {
      const slot = person.slot ?? '';
      const id = await services.createAccount(
        demoEmail(slot, sandbox),
        provisioningOf(person, places.postedOn, 'hi'),
      );
      await services.noteAccount(sandbox, id);
      staff[slot] = id;
    });
    const accounts: Record<string, { id: string; email: string }> = {};
    for (const person of places.accounts) {
      const email = demoEmail(person.role, sandbox);
      const id = await services.createAccount(
        email,
        provisioningOf(person, places.postedOn, language),
      );
      await services.noteAccount(sandbox, id);
      accounts[person.role] = { id, email };
    }
    await services.build(sandbox, 'people', { accounts, staff });

    for (const step of HISTORY_STEPS) {
      await services.build(sandbox, step);
    }
    const finished = await services.build(sandbox, 'finish', {
      recordings: recordingDetails(recordings.list),
    });
    const uploads = Array.isArray(finished.uploads) ? finished.uploads : [];
    for (const upload of uploads) {
      if (isRecord(upload) && typeof upload.key === 'string' && typeof upload.path === 'string') {
        await services.storeFile(
          'pulse-audio',
          upload.path,
          await recordings.bytes(upload.key),
          typeof upload.type === 'string' ? upload.type : 'audio/webm',
        );
      }
    }
    return accounts[role]?.email ?? '';
  } catch (error) {
    // Nothing half-built is left: the district ends at once, so that the sweep takes it should
    // removing it now fail too; it goes with the identities nobody else uses (background staff
    // the district took in are shared with the others and stay).
    await services.expire(sandbox).catch(() => undefined);
    await services.remove(sandbox).catch(() => undefined);
    await deleteListedAccounts(services).catch(() => undefined);
    throw error;
  }
}

/** Deletes identities whose district is gone. Each is taken off the list once deleted. */
async function deleteListedAccounts(
  services: DemoServices,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const id of await services.accountsToDelete(DELETE_AT_ONCE)) {
    try {
      await services.deleteAccount(id);
      await services.accountDeleted(id);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `demo: deleting an account failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { deleted, failed };
}

export function handleDemoStart(
  body: unknown,
  clientKey: string,
  services: DemoServices,
  recordings: RecordingSource,
  enabled: boolean,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (!enabled) {
      return failure(503, 'not_configured');
    }
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    const role = readOneOf(body, 'role', DEMO_ROLES);
    const language = readLanguage(body);

    const opening = await services.open(clientKey);
    if (opening.status === 'busy') {
      return failure(503, 'busy');
    }
    if (opening.status === 'unavailable') {
      return failure(503, 'not_configured');
    }
    if (opening.status === 'throttled') {
      return failure(429, 'throttled', { retry_after_seconds: opening.retryAfterSeconds });
    }
    const email = await build(services, opening.sandbox, role, language, recordings);
    return ok({ token_hash: await services.signInToken(email), role });
  });
}

export function handleDemoSwitch(
  body: unknown,
  userId: string | null,
  services: DemoServices,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (!userId) {
      return failure(401, 'forbidden');
    }
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    const role = readOneOf(body, 'role', DEMO_ROLES);
    const sandbox = await services.sandboxOf(userId);
    if (!sandbox) {
      return failure(403, 'forbidden');
    }
    const email = await services.accountEmail(sandbox, role);
    if (!email) {
      return failure(404, 'not_found');
    }
    return ok({ token_hash: await services.signInToken(email), role });
  });
}

/**
 * Removes expired districts: first the identities still listed from earlier removals, then each
 * district's files and data, then the identities its removal listed.
 */
export async function handleDemoSweep(
  token: string | null,
  services: DemoServices,
): Promise<HandlerResult> {
  if (!token || !(await services.jobTokenIsValid(token))) {
    return failure(403, 'forbidden');
  }
  const earlier = await deleteListedAccounts(services);
  let removed = 0;
  let failed = 0;
  for (const district of await services.due(5)) {
    try {
      await services.removing(district.sandbox);
      for (const [bucket, paths] of Object.entries(district.files)) {
        if (paths.length > 0) {
          await services.removeFiles(bucket, paths);
        }
      }
      await services.remove(district.sandbox);
      removed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `demo: removing ${district.sandbox} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const now = await deleteListedAccounts(services);
  return ok({
    removed,
    failed,
    accounts_deleted: earlier.deleted + now.deleted,
    accounts_failed: earlier.failed + now.failed,
  });
}
