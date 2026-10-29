import { readdir } from 'node:fs/promises';

const MIGRATION_FILE = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** Versions of the migrations in this code, oldest first. */
export async function localMigrationVersions(
  directory: URL = new URL('../../../supabase/migrations/', import.meta.url),
): Promise<string[]> {
  const names = await readdir(directory);
  return names.flatMap((name) => MIGRATION_FILE.exec(name)?.[1] ?? []).sort();
}

/** The versions of this code that the database has not applied yet. */
export function pendingMigrations(local: readonly string[], applied: readonly string[]): string[] {
  const done = new Set(applied);
  return local.filter((version) => !done.has(version));
}
