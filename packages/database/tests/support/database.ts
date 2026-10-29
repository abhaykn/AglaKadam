import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const migrationsDirectory = new URL('../../../../supabase/migrations/', import.meta.url);
const shimFile = new URL('./supabase-shim.sql', import.meta.url);

/**
 * Who a statement runs as. `anon`, `user` and `service` mirror the roles the Data API switches to;
 * `owner` keeps the database owner, for setup steps that are expected to fail.
 */
export type Identity =
  { kind: 'owner' } | { kind: 'anon' } | { kind: 'user'; id: string } | { kind: 'service' };

export const owner: Identity = { kind: 'owner' };

export type QueryFunction = <Row = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<Row[]>;

export interface TestDatabase {
  /** Runs a statement as the database owner, bypassing row level security. */
  query: QueryFunction;
  /** Runs work as an API identity inside a savepoint; a failure leaves no trace. */
  as: <Result>(
    identity: Identity,
    work: (query: QueryFunction) => Promise<Result>,
  ) => Promise<Result>;
  /** Opens the per-test transaction. */
  begin: () => Promise<void>;
  /** Discards everything the current test changed. */
  rollback: () => Promise<void>;
  close: () => Promise<void>;
}

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(new URL(name, migrationsDirectory), 'utf8'),
    })),
  );
}

function claimsFor(identity: Identity): { role: string | null; claims: string } {
  switch (identity.kind) {
    case 'owner':
      return { role: null, claims: '' };
    case 'anon':
      return { role: 'anon', claims: JSON.stringify({ role: 'anon' }) };
    case 'service':
      return { role: 'service_role', claims: JSON.stringify({ role: 'service_role' }) };
    case 'user':
      return {
        role: 'authenticated',
        claims: JSON.stringify({ sub: identity.id, role: 'authenticated' }),
      };
  }
}

/** Boots an in-process Postgres, applies the platform stand-in and every migration in order. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await readFile(shimFile, 'utf8'));

  for (const migration of await readMigrations()) {
    try {
      await db.exec(migration.sql);
    } catch (error) {
      throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  let inTransaction = false;

  const query: QueryFunction = async <Row>(sql: string, params: unknown[] = []) => {
    const result = await db.query<Row>(sql, params);
    return result.rows;
  };

  return {
    query,
    async as(identity, work) {
      if (!inTransaction) {
        throw new Error('Call begin() before acting as an identity.');
      }
      const { role, claims } = claimsFor(identity);
      await db.exec('savepoint acting_as');
      try {
        if (role) {
          await db.exec(`set local role ${role}`);
        }
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
        const result = await work(query);
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claims', '', true)`);
        await db.exec('release savepoint acting_as');
        return result;
      } catch (error) {
        await db.exec('rollback to savepoint acting_as');
        await db.exec('release savepoint acting_as');
        throw error;
      }
    },
    async begin() {
      await db.exec('begin');
      inTransaction = true;
    },
    async rollback() {
      await db.exec('rollback');
      inTransaction = false;
    },
    async close() {
      await db.close();
    },
  };
}

/** Postgres error code of a rejected database call, for precise assertions. */
export async function errorCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('Expected the database call to fail, but it succeeded.');
}
