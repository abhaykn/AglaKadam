import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './support/database';
import { createScenario } from './support/scenario';

/**
 * The places of the demonstration: twenty-five districts at a time. A visitor is not turned away
 * while a district that nobody is likely to be using still stands.
 */
let database: TestDatabase;

const service = { kind: 'service' } as const;

beforeAll(async () => {
  database = await createTestDatabase();
  await createScenario(database);
});

afterAll(async () => {
  await database.close();
});

async function open(clientKey: string) {
  const rows = await database.as(service, (query) =>
    query<{ result: { status: string; sandbox?: string } }>(
      'select public.service_demo_open($1) as result',
      [clientKey],
    ),
  );
  return rows[0]?.result;
}

/** Districts that stand, opened the given number of minutes ago, one after the other. */
async function fill(count: number, minutesAgo: (index: number) => number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const [row] = await database.query<{ id: string }>(
      `insert into private.demo_sandboxes (client_key, status, created_at)
       values ($1, 'ready', now() - make_interval(mins => $2)) returning id`,
      [`filler-${String(index)}`, minutesAgo(index)],
    );
    ids.push(String(row?.id));
  }
  return ids;
}

async function standing(): Promise<number> {
  const [row] = await database.query<{ count: number }>(
    'select count(*)::int as count from private.demo_sandboxes where expires_at > now()',
  );
  return Number(row?.count);
}

describe('the places of the demonstration', () => {
  it('makes the oldest district that has been open a while make way when every place is taken', async () => {
    await database.begin();
    try {
      // Twenty-five districts, the first opened an hour ago and the last half an hour ago.
      const ids = await fill(25, (index) => 60 - index);
      expect(await standing()).toBe(25);

      const opened = await open('judge-1');
      expect(opened?.status).toBe('ok');
      expect(await standing()).toBe(25);
      const [oldest] = await database.query<{ standing: boolean }>(
        'select expires_at > now() as standing from private.demo_sandboxes where id = $1',
        [ids[0]],
      );
      expect(oldest?.standing).toBe(false);
      const [newest] = await database.query<{ standing: boolean }>(
        'select expires_at > now() as standing from private.demo_sandboxes where id = $1',
        [ids[24]],
      );
      expect(newest?.standing).toBe(true);
    } finally {
      await database.rollback();
    }
  });

  it('keeps taking the oldest as more visitors come, never more than twenty-five at once', async () => {
    await database.begin();
    try {
      await fill(25, (index) => 120 - index);
      for (let visitor = 0; visitor < 5; visitor += 1) {
        expect((await open(`judge-${String(visitor)}`))?.status).toBe('ok');
        expect(await standing()).toBe(25);
      }
    } finally {
      await database.rollback();
    }
  });

  it('never takes a district from a visitor who has only just opened it', async () => {
    await database.begin();
    try {
      // Every district was opened within the last five minutes: the demonstration is crowded.
      const ids = await fill(25, (index) => index % 5);
      expect((await open('late-visitor'))?.status).toBe('busy');
      expect(await standing()).toBe(25);
      const [kept] = await database.query<{ count: number }>(
        'select count(*)::int as count from private.demo_sandboxes where id = any ($1::uuid[]) and expires_at > now()',
        [ids],
      );
      expect(kept?.count).toBe(25);
    } finally {
      await database.rollback();
    }
  });

  it('opens a district at once when a place is free', async () => {
    await database.begin();
    try {
      await fill(10, () => 5);
      expect((await open('visitor'))?.status).toBe('ok');
      expect(await standing()).toBe(11);
    } finally {
      await database.rollback();
    }
  });

  it('still limits how many one network opens in an hour', async () => {
    await database.begin();
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect((await open('one-venue'))?.status).toBe('ok');
        // Keep a place free: this test is about the network, not the places.
        await database.query(
          "update private.demo_sandboxes set expires_at = now() where client_key = 'one-venue'",
        );
      }
      expect((await open('one-venue'))?.status).toBe('throttled');
    } finally {
      await database.rollback();
    }
  });
});
