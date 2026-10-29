/**
 * Live check of the deployed project.
 *
 *   npm run check:live                 run every check, then remove what the run created
 *   npm run check:live -- --clean-up   only remove what an interrupted earlier run left behind
 *   npm run review:live                set up a school and an account for every role, wait while
 *                                      the screens are reviewed by hand, then remove it all
 *
 * The check asks for the project's secret key without showing it (or reads SUPABASE_SECRET_KEY).
 * The key stays in memory and is used only to create the temporary administrator and to delete the
 * recordings the run uploaded. Test records are removed through the Supabase CLI, which must be
 * logged in and linked to the same project.
 */
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import { runLiveCheck, type RunState } from './check.ts';
import {
  classNoteFilesSql,
  cleanupSql,
  leftoversSql,
  type RunRecords,
  toLeftovers,
} from './cleanup.ts';
import { runSql } from './database-cli.ts';
import { readEnvironment, readSecretKey, type Environment } from './environment.ts';
import { localMigrationVersions, pendingMigrations } from './migrations.ts';
import { expect, Report } from './report.ts';
import { prepareReview, reviewRecordings, reviewVoiceNotes, type ReviewAccount } from './review.ts';
import { newRunTag } from './values.ts';

/**
 * Files can only be deleted through the Storage API, with the secret key. Files an interrupted run
 * left behind are deleted by the daily retention job, which removes uploads no check claims.
 */
async function removeFiles(
  environment: Environment,
  secretKey: string,
  paths: string[],
  bucket = 'pulse-audio',
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const service = createClient(environment.supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await service.storage.from(bucket).remove(paths);
  expect(error === null, `Recordings could not be removed (${error?.message ?? ''}).`);
}

async function removeRecords(
  report: Report,
  run: RunRecords,
  userIds: string[],
  files: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await report.check('Every record of the check is removed', async () => {
    await files();
    await runSql(cleanupSql(run));
    const leftovers = toLeftovers((await runSql(leftoversSql(run, userIds)))[0]);
    expect(
      leftovers.states === 0 &&
        leftovers.schools === 0 &&
        leftovers.accounts === 0 &&
        leftovers.auditEvents === 0,
      `Records are left: ${JSON.stringify(leftovers)}. ` +
        'Run "npm run check:live -- --clean-up" to remove them.',
    );
  });
}

/** The review's sign-in details, printed in this terminal only. */
function printAccounts(accounts: readonly ReviewAccount[]): void {
  const width = Math.max(...accounts.map((account) => account.role.length));
  console.log(
    '\nSign-in details for the review. They are shown only here; every account is removed at the end.\n',
  );
  for (const account of accounts) {
    console.log(`  ${account.role.padEnd(width)}   ${account.signInWith}   ${account.secret}`);
    if (account.note) {
      console.log(`  ${' '.repeat(width)}   ${account.note}`);
    }
  }
  console.log('');
}

/** Waits for Enter, or Ctrl+C; either ends the review. */
async function waitForEnter(question: string): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const stop = new AbortController();
  prompt.on('SIGINT', () => {
    stop.abort();
  });
  try {
    await prompt.question(question, { signal: stop.signal });
  } catch {
    // Ctrl+C: the review ends the same way.
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const cleanUpOnly = process.argv.includes('--clean-up');
  const review = process.argv.includes('--review');
  console.log('Agla Kadam live check');
  const environment = await readEnvironment();
  console.log(`Project: ${environment.projectRef}\n`);

  const report = new Report();
  // The records are removed through the CLI, so that route must work before anything is created.
  await report.check('The Supabase CLI can remove test records', async () => {
    const [row] = await runSql('select 1 as ready');
    expect(row?.ready === 1, 'The CLI did not return the expected answer.');
  });
  // Every check, and the removal of the records, assume the database matches this code. A run
  // against an older schema would fail halfway and could not remove what it had created.
  await report.check('The database has every migration of this code', async () => {
    const applied = await runSql('select version from supabase_migrations.schema_migrations');
    const pending = pendingMigrations(
      await localMigrationVersions(),
      applied.map((row) => String(row.version)),
    );
    expect(
      pending.length === 0,
      `Not applied yet: ${pending.join(', ')}. Run "npx supabase db push" first, on a network ` +
        'that allows port 5432 (for example a mobile hotspot).',
    );
  });

  if (cleanUpOnly) {
    await removeRecords(report, { staffEmails: [], createdAcademicYearId: null }, []);
    return;
  }

  const secretKey = await readSecretKey();
  const run: RunState = {
    tag: newRunTag(),
    staffEmails: [],
    createdAcademicYearId: null,
    userIds: [],
    pulseFiles: [],
    noteFiles: [],
  };
  console.log(
    review
      ? `Review ${run.tag}: everything it sets up is removed when you end the review.\n`
      : `Run ${run.tag}: everything this run creates is removed at the end.\n`,
  );

  let removal: Promise<void> | null = null;
  const removeOnce = () =>
    (removal ??= removeRecords(report, run, run.userIds, async () => {
      await removeFiles(environment, secretKey, run.pulseFiles);
      await removeFiles(environment, secretKey, run.noteFiles, 'visit-notes');
      // Files of notes sent during the run or the review, found by their classes.
      const classNotes = await runSql(classNoteFilesSql());
      await removeFiles(
        environment,
        secretKey,
        classNotes.map((row) => String(row.name)),
        'class-notes',
      );
    }).catch(() => undefined));
  process.once('SIGINT', () => {
    console.log('\nInterrupted. Removing the records of this run ...');
    void removeOnce().then(() => process.exit(130));
  });

  let reviewedClass: string | null = null;
  try {
    if (review) {
      const prepared = await prepareReview(environment, secretKey, report, run);
      reviewedClass = prepared.classSectionId;
      printAccounts(prepared.accounts);
      await waitForEnter('Press Enter when the review is finished; everything is then removed. ');
    } else {
      await runLiveCheck(environment, secretKey, report, run);
    }
  } catch {
    // The failed check has been reported; the records are removed below either way.
  } finally {
    if (reviewedClass !== null) {
      // Recordings and voice notes made on the screens during the review.
      run.pulseFiles.push(...(await reviewRecordings(reviewedClass).catch(() => [])));
      run.noteFiles.push(...(await reviewVoiceNotes(reviewedClass).catch(() => [])));
    }
    console.log('');
    await removeOnce();
  }

  const total = report.passed + report.failed;
  console.log(
    report.failed === 0
      ? `\nAll ${total} checks passed.`
      : `\n${report.failed} of ${total} checks failed; see the details above.`,
  );
  process.exitCode = report.failed === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
