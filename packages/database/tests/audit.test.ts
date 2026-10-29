import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './support/database';
import { asUser, createScenario, type Scenario } from './support/scenario';

let database: TestDatabase;
let scenario: Scenario;

beforeAll(async () => {
  database = await createTestDatabase();
  scenario = await createScenario(database);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.begin();
});

afterEach(async () => {
  await database.rollback();
});

interface AuditRow {
  actor_id: string | null;
  actor_role: string;
  operation: string;
  record_id: string | null;
  changes: Record<string, unknown>;
}

async function latestEvent(table: string): Promise<AuditRow | undefined> {
  const [row] = await database.query<AuditRow>(
    `select actor_id, actor_role, operation, record_id, changes
     from public.audit_events where table_name = $1 order by id desc limit 1`,
    [table],
  );
  return row;
}

describe('audit trail', () => {
  it('records who made a change and only the fields that changed', async () => {
    await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query(`update public.schools set name_en = 'School A1 Renamed' where id = $1`, [
        scenario.schoolA1Id,
      ]),
    );

    expect(await latestEvent('schools')).toEqual({
      actor_id: scenario.staff.superAdmin,
      actor_role: 'authenticated',
      operation: 'UPDATE',
      record_id: scenario.schoolA1Id,
      changes: { name_en: { old: 'School A1', new: 'School A1 Renamed' } },
    });
  });

  it('skips updates that change nothing', async () => {
    const [before] = await database.query<{ total: number }>(
      'select count(*)::int as total from public.audit_events',
    );
    await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query(`update public.schools set name_en = name_en where id = $1`, [scenario.schoolA1Id]),
    );
    const [after] = await database.query<{ total: number }>(
      'select count(*)::int as total from public.audit_events',
    );
    expect(after?.total).toBe(before?.total);
  });

  it('captures changes made by the CRP to student records', async () => {
    await database.as(asUser(scenario.staff.crpA), (query) =>
      query(`update public.students set full_name = 'Learner Two Corrected' where id = $1`, [
        scenario.students.a1Active[1],
      ]),
    );
    const event = await latestEvent('students');
    expect(event?.actor_id).toBe(scenario.staff.crpA);
    expect(event?.changes).toEqual({
      full_name: { old: 'Learner Two', new: 'Learner Two Corrected' },
    });
  });

  it('is readable only by super administrators', async () => {
    const forTeacher = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('select id from public.audit_events'),
    );
    expect(forTeacher).toEqual([]);

    const forAdmin = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query('select id from public.audit_events'),
    );
    expect(forAdmin.length).toBeGreaterThan(0);
  });

  it('removes events older than two years', async () => {
    await database.query(
      `update public.audit_events set occurred_at = now() - interval '2 years 1 day'
       where id = (select min(id) from public.audit_events)`,
    );
    const [result] = await database.query<{ removed: number }>(
      'select private.purge_expired_audit_events()::int as removed',
    );
    expect(result?.removed).toBe(1);
  });
});
