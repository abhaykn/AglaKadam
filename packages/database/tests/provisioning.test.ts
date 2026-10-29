import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, owner, type TestDatabase } from './support/database';
import {
  asUser,
  createAuthIdentity,
  createScenario,
  insertStudent,
  provisionFamily,
  provisionStaff,
  type Scenario,
} from './support/scenario';

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

describe('staff provisioning', () => {
  it('creates the profile and the first assignment together with the identity', async () => {
    const id = await provisionStaff(database.query, {
      fullName: '  Sunita Devi  ',
      role: 'crp',
      scopeId: scenario.clusterBId,
      provisionedBy: scenario.staff.superAdmin,
    });

    const [profile] = await database.query<{ full_name: string; account_kind: string }>(
      'select full_name, account_kind from public.profiles where id = $1',
      [id],
    );
    expect(profile).toEqual({ full_name: 'Sunita Devi', account_kind: 'staff' });

    const assignments = await database.query<{
      role: string;
      cluster_id: string;
      created_by: string;
    }>('select role, cluster_id, created_by from public.staff_assignments where user_id = $1', [
      id,
    ]);
    expect(assignments).toEqual([
      { role: 'crp', cluster_id: scenario.clusterBId, created_by: scenario.staff.superAdmin },
    ]);
  });

  it('records the start date of an existing posting', async () => {
    const id = await createAuthIdentity(database.query, {
      provisioning: {
        account_kind: 'staff',
        full_name: 'Existing Teacher',
        assignment: { role: 'teacher', scope_id: scenario.schoolA2Id, starts_on: '2024-06-15' },
      },
    });
    const [assignment] = await database.query<{ starts_on: string }>(
      'select starts_on::text from public.staff_assignments where user_id = $1',
      [id],
    );
    expect(assignment?.starts_on).toBe('2024-06-15');
  });

  it('rejects staff without an assignment and leaves no identity behind', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        createAuthIdentity(query, {
          provisioning: { account_kind: 'staff', full_name: 'Incomplete' },
        }),
      ),
    );
    expect(code).toBe('22023');
    const [count] = await database.query<{ total: number }>(
      'select count(*)::int as total from auth.users',
    );
    const [profiles] = await database.query<{ total: number }>(
      'select count(*)::int as total from public.profiles',
    );
    expect(count?.total).toBe(profiles?.total);
  });

  it('rejects an unknown role', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        provisionStaff(query, {
          fullName: 'Someone',
          role: 'principal' as 'teacher',
          scopeId: scenario.schoolA1Id,
        }),
      ),
    );
    expect(code).toBe('22P02');
  });

  it('rejects a scoped role without a scope', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        provisionStaff(query, { fullName: 'Someone', role: 'teacher' }),
      ),
    );
    expect(code).toBe('22023');
  });

  it('rejects a scope of the wrong level for the role', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        provisionStaff(query, {
          fullName: 'Someone',
          role: 'teacher',
          scopeId: scenario.clusterAId,
        }),
      ),
    );
    expect(code).toBe('23503');
  });

  it('ignores provisioning data placed in user-editable metadata', async () => {
    const id = await createAuthIdentity(
      database.query,
      {},
      {
        provisioning: {
          account_kind: 'staff',
          full_name: 'Self',
          assignment: { role: 'super_admin' },
        },
      },
    );
    const profiles = await database.query('select id from public.profiles where id = $1', [id]);
    expect(profiles).toEqual([]);

    const visibleSchools = await database.as(asUser(id), (query) =>
      query('select id from public.schools'),
    );
    expect(visibleSchools).toEqual([]);
  });
});

describe('family provisioning', () => {
  it('links the account to a verified student', async () => {
    const studentId = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Asha Kumari',
    });
    const accountId = await provisionFamily(database.query, studentId);

    const [student] = await database.query<{ auth_user_id: string }>(
      'select auth_user_id from public.students where id = $1',
      [studentId],
    );
    expect(student?.auth_user_id).toBe(accountId);

    const [profile] = await database.query<{ full_name: string; account_kind: string }>(
      'select full_name, account_kind from public.profiles where id = $1',
      [accountId],
    );
    expect(profile).toEqual({ full_name: 'Asha Kumari', account_kind: 'student' });
  });

  it('refuses a student who is still awaiting verification', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) => provisionFamily(query, scenario.students.a1Pending)),
    );
    expect(code).toBe('22023');
  });

  it('refuses a second account for the same student', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) => provisionFamily(query, scenario.students.a1Active[0])),
    );
    expect(code).toBe('22023');
  });
});

describe('first super administrator', () => {
  it('refuses to run while a super administrator exists', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        query(`select private.bootstrap_super_admin('nobody@test.invalid', 'Nobody')`),
      ),
    );
    expect(code).toBe('42501');
  });

  it('promotes an existing identity on a fresh installation', async () => {
    await database.query(
      `alter table public.staff_assignments disable trigger staff_assignments_guard_write`,
    );
    await database.query(`delete from public.staff_assignments where role = 'super_admin'`);
    await database.query(
      `alter table public.staff_assignments enable trigger staff_assignments_guard_write`,
    );

    const identityId = await createAuthIdentity(database.query, {});
    const [email] = await database.query<{ email: string }>(
      'select email from auth.users where id = $1',
      [identityId],
    );
    const [result] = await database.query<{ id: string }>(
      'select private.bootstrap_super_admin($1, $2) as id',
      [email?.email.toUpperCase(), 'Platform Administrator'],
    );
    expect(result?.id).toBe(identityId);

    const isAdmin = await database.as(asUser(identityId), (query) =>
      query<{ is_admin: boolean }>('select private.is_super_admin() as is_admin'),
    );
    expect(isAdmin).toEqual([{ is_admin: true }]);

    const secondAttempt = await errorCodeOf(
      database.as(owner, (query) =>
        query(`select private.bootstrap_super_admin($1, 'Another')`, [email?.email]),
      ),
    );
    expect(secondAttempt).toBe('42501');
  });

  it('cannot be called through the API', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`select private.bootstrap_super_admin('x@test.invalid', 'X')`),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('provisioning events', () => {
  it('also provisions when the details arrive with the insert itself', async () => {
    const id = '7f1d7c4e-36c1-4a35-9d4e-2f6a9f1b0c11';
    await database.query(
      `insert into auth.users (id, email, raw_app_meta_data) values ($1, 'direct@test.invalid', $2)`,
      [
        id,
        JSON.stringify({
          provisioning: {
            account_kind: 'staff',
            full_name: 'Direct Insert',
            assignment: { role: 'teacher', scope_id: scenario.schoolA2Id },
          },
        }),
      ],
    );
    const profiles = await database.query('select id from public.profiles where id = $1', [id]);
    expect(profiles).toHaveLength(1);
  });

  it('does not provision again when app metadata changes later', async () => {
    await database.query(
      `update auth.users
       set raw_app_meta_data = raw_app_meta_data || '{"last_provider": "email"}'::jsonb
       where id = $1`,
      [scenario.staff.teacherA1],
    );
    const [assignments] = await database.query<{ total: number }>(
      'select count(*)::int as total from public.staff_assignments where user_id = $1',
      [scenario.staff.teacherA1],
    );
    expect(assignments?.total).toBe(1);
  });

  it('provisions an identity that was created without details once they are added', async () => {
    const id = await createAuthIdentity(database.query, {});
    await database.query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1`,
      [
        id,
        JSON.stringify({
          provisioning: {
            account_kind: 'staff',
            full_name: 'Linked Later',
            assignment: { role: 'crp', scope_id: scenario.clusterCId },
          },
        }),
      ],
    );
    const [assignment] = await database.query<{ role: string }>(
      'select role from public.staff_assignments where user_id = $1',
      [id],
    );
    expect(assignment?.role).toBe('crp');
  });
});
