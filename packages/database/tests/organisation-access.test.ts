import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, owner, type TestDatabase } from './support/database';
import { asUser, createAuthIdentity, createScenario, type Scenario } from './support/scenario';

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

async function visibleIds(userId: string, table: string): Promise<string[]> {
  const rows = await database.as(asUser(userId), (query) =>
    query<{ id: string }>(`select id from public.${table} order by id`),
  );
  return rows.map((row) => row.id);
}

function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

describe('school visibility', () => {
  it('shows every school to a super administrator', async () => {
    expect(await visibleIds(scenario.staff.superAdmin, 'schools')).toEqual(
      sorted([scenario.schoolA1Id, scenario.schoolA2Id, scenario.schoolB1Id, scenario.schoolC1Id]),
    );
  });

  it('shows the district officer every school in the district', async () => {
    expect(await visibleIds(scenario.staff.districtOfficer, 'schools')).toEqual(
      sorted([scenario.schoolA1Id, scenario.schoolA2Id, scenario.schoolB1Id, scenario.schoolC1Id]),
    );
  });

  it('shows the block officer only the schools of the block', async () => {
    expect(await visibleIds(scenario.staff.blockOfficer, 'schools')).toEqual(
      sorted([scenario.schoolA1Id, scenario.schoolA2Id, scenario.schoolB1Id]),
    );
  });

  it('shows a CRP only the schools of the cluster', async () => {
    expect(await visibleIds(scenario.staff.crpA, 'schools')).toEqual(
      sorted([scenario.schoolA1Id, scenario.schoolA2Id]),
    );
  });

  it('shows a teacher only their own school', async () => {
    expect(await visibleIds(scenario.staff.teacherA1, 'schools')).toEqual([scenario.schoolA1Id]);
  });

  it('shows a family account only the child’s school', async () => {
    expect(await visibleIds(scenario.familyAccountId, 'schools')).toEqual([scenario.schoolA1Id]);
  });

  it('shows nothing to an identity without a profile', async () => {
    const strangerId = await createAuthIdentity(database.query, {});
    expect(await visibleIds(strangerId, 'schools')).toEqual([]);
    expect(await visibleIds(strangerId, 'states')).toEqual([]);
  });

  it('stops showing schools once an assignment has ended', async () => {
    await database.query(
      `update public.staff_assignments set ends_on = private.today() - 1 where user_id = $1`,
      [scenario.staff.teacherA1],
    );
    expect(await visibleIds(scenario.staff.teacherA1, 'schools')).toEqual([]);
  });

  it('stops showing schools once an account is deactivated', async () => {
    await database.query('update public.profiles set is_active = false where id = $1', [
      scenario.staff.crpA,
    ]);
    expect(await visibleIds(scenario.staff.crpA, 'schools')).toEqual([]);
  });
});

describe('geography', () => {
  it('is readable by staff but not by family accounts', async () => {
    expect(await visibleIds(scenario.staff.teacherA1, 'clusters')).toHaveLength(3);
    expect(await visibleIds(scenario.familyAccountId, 'clusters')).toEqual([]);
  });

  it('can only be changed by a super administrator', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(
          `insert into public.schools (cluster_id, udise_code, name_en) values ($1, '09010100199', 'New')`,
          [scenario.clusterAId],
        ),
      ),
    );
    expect(code).toBe('42501');

    const updated = await database.as(asUser(scenario.staff.blockOfficer), (query) =>
      query(`update public.schools set name_en = 'Renamed' where id = $1 returning id`, [
        scenario.schoolA1Id,
      ]),
    );
    expect(updated).toEqual([]);

    const inserted = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ id: string }>(
        `insert into public.schools (cluster_id, udise_code, name_en)
         values ($1, '09010100199', 'New School') returning id`,
        [scenario.clusterAId],
      ),
    );
    expect(inserted).toHaveLength(1);
  });

  it('rejects malformed UDISE codes', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(
          `insert into public.schools (cluster_id, udise_code, name_en) values ($1, '0901', 'Short')`,
          [scenario.clusterAId],
        ),
      ),
    );
    expect(code).toBe('23514');
  });
});

describe('profile visibility', () => {
  it('lets a teacher see colleagues and the cluster CRP but no one else', async () => {
    expect(await visibleIds(scenario.staff.teacherA1, 'profiles')).toEqual(
      sorted([scenario.staff.teacherA1, scenario.staff.teacherA1Colleague, scenario.staff.crpA]),
    );
  });

  it('lets a CRP see the teachers of the cluster', async () => {
    expect(await visibleIds(scenario.staff.crpA, 'profiles')).toEqual(
      sorted([
        scenario.staff.crpA,
        scenario.staff.teacherA1,
        scenario.staff.teacherA1Colleague,
        scenario.staff.teacherA2,
      ]),
    );
  });

  it('lets a block officer see CRPs of the block but no teachers', async () => {
    expect(await visibleIds(scenario.staff.blockOfficer, 'profiles')).toEqual(
      sorted([scenario.staff.blockOfficer, scenario.staff.crpA, scenario.staff.crpB]),
    );
  });

  it('lets a family account see only its own profile', async () => {
    expect(await visibleIds(scenario.familyAccountId, 'profiles')).toEqual([
      scenario.familyAccountId,
    ]);
  });
});

describe('profile updates', () => {
  it('allows users to change their own language preference', async () => {
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ preferred_language: string }>(
        `update public.profiles set preferred_language = 'en' where id = $1
         returning preferred_language`,
        [scenario.staff.teacherA1],
      ),
    );
    expect(rows).toEqual([{ preferred_language: 'en' }]);
  });

  it('prevents users from renaming or reactivating themselves', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(`update public.profiles set full_name = 'Changed' where id = $1`, [
          scenario.staff.teacherA1,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('prevents users from editing other profiles', async () => {
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(`update public.profiles set preferred_language = 'en' where id = $1 returning id`, [
        scenario.staff.teacherA1Colleague,
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('lets a super administrator correct a name', async () => {
    const rows = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ full_name: string }>(
        `update public.profiles set full_name = 'Corrected Name' where id = $1 returning full_name`,
        [scenario.staff.teacherA1],
      ),
    );
    expect(rows).toEqual([{ full_name: 'Corrected Name' }]);
  });

  it('never lets the account kind change', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`update public.profiles set account_kind = 'student' where id = $1`, [
          scenario.staff.teacherA1,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('staff assignments', () => {
  it('can only be created by a super administrator', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.crpA), (query) =>
        query(
          `insert into public.staff_assignments (user_id, role, school_id) values ($1, 'teacher', $2)`,
          [scenario.staff.crpA, scenario.schoolA1Id],
        ),
      ),
    );
    expect(code).toBe('42501');
  });

  it('records the administrator who created an assignment', async () => {
    const [row] = await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query<{ created_by: string }>(
        `insert into public.staff_assignments (user_id, role, school_id, created_by)
         values ($1, 'teacher', $2, $3) returning created_by`,
        [scenario.staff.crpA, scenario.schoolA2Id, scenario.staff.teacherA1],
      ),
    );
    expect(row?.created_by).toBe(scenario.staff.superAdmin);
  });

  it('transfers a teacher by ending one assignment and starting another', async () => {
    await database.as(asUser(scenario.staff.superAdmin), async (query) => {
      await query(
        `update public.staff_assignments set ends_on = private.today() - 1
         where user_id = $1 and ends_on is null`,
        [scenario.staff.teacherA2],
      );
      await query(
        `insert into public.staff_assignments (user_id, role, school_id) values ($1, 'teacher', $2)`,
        [scenario.staff.teacherA2, scenario.schoolB1Id],
      );
    });
    expect(await visibleIds(scenario.staff.teacherA2, 'schools')).toEqual([scenario.schoolB1Id]);
  });

  it('allows only the end date of an assignment to change', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(`update public.staff_assignments set school_id = $2 where user_id = $1`, [
          scenario.staff.teacherA1,
          scenario.schoolA2Id,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('prevents two open assignments for the same role and scope', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(
          `insert into public.staff_assignments (user_id, role, school_id) values ($1, 'teacher', $2)`,
          [scenario.staff.teacherA1, scenario.schoolA1Id],
        ),
      ),
    );
    expect(code).toBe('23505');
  });

  it('protects the last super administrator from being ended or deactivated', async () => {
    const endCode = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(
          `update public.staff_assignments set ends_on = private.today()
           where user_id = $1 and role = 'super_admin'`,
          [scenario.staff.superAdmin],
        ),
      ),
    );
    expect(endCode).toBe('42501');

    const deactivateCode = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query('update public.profiles set is_active = false where id = $1', [
          scenario.staff.superAdmin,
        ]),
      ),
    );
    expect(deactivateCode).toBe('42501');
  });

  it('allows a super administrator to step down once another exists', async () => {
    await database.as(asUser(scenario.staff.superAdmin), async (query) => {
      await query(
        `insert into public.staff_assignments (user_id, role) values ($1, 'super_admin')`,
        [scenario.staff.crpA],
      );
      await query(
        `update public.staff_assignments set ends_on = private.today()
         where user_id = $1 and role = 'super_admin'`,
        [scenario.staff.superAdmin],
      );
    });
    const [row] = await database.query<{ ends_on: string | null }>(
      `select ends_on::text from public.staff_assignments where user_id = $1 and role = 'super_admin'`,
      [scenario.staff.superAdmin],
    );
    expect(row?.ends_on).not.toBeNull();
  });

  it('cannot be deleted through the API', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query('delete from public.staff_assignments where user_id = $1', [
          scenario.staff.teacherA1,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('super administrator continuity', () => {
  it('does not count an administrator whose assignment has not started yet', async () => {
    await database.as(asUser(scenario.staff.superAdmin), (query) =>
      query(
        `insert into public.staff_assignments (user_id, role, starts_on)
         values ($1, 'super_admin', private.today() + 30)`,
        [scenario.staff.crpA],
      ),
    );
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.superAdmin), (query) =>
        query(
          `update public.staff_assignments set ends_on = private.today()
           where user_id = $1 and role = 'super_admin'`,
          [scenario.staff.superAdmin],
        ),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('assignment history', () => {
  it('shows colleagues only their current assignments', async () => {
    await database.query(
      `insert into public.staff_assignments (user_id, role, school_id, starts_on, ends_on)
       values ($1, 'teacher', $2, private.today() - 400, private.today() - 200)`,
      [scenario.staff.teacherA1Colleague, scenario.schoolB1Id],
    );
    const rows = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ school_id: string }>(
        'select school_id from public.staff_assignments where user_id = $1',
        [scenario.staff.teacherA1Colleague],
      ),
    );
    expect(rows).toEqual([{ school_id: scenario.schoolA1Id }]);
  });
});

describe('removing accounts', () => {
  it('removes a teacher who added records, keeping the records', async () => {
    const [student] = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ id: string }>(
        `insert into public.students (school_id, full_name, gender) values ($1, 'Added', 'female')
         returning id`,
        [scenario.schoolA1Id],
      ),
    );
    await database.query('delete from auth.users where id = $1', [scenario.staff.teacherA1]);
    const [row] = await database.query<{ created_by: string | null }>(
      'select created_by from public.students where id = $1',
      [student?.id],
    );
    expect(row).toEqual({ created_by: null });
  });

  it('removes an administrator who provisioned others once another administrator exists', async () => {
    await database.query(
      `insert into public.staff_assignments (user_id, role, starts_on)
       values ($1, 'super_admin', private.today() - 1)`,
      [scenario.staff.crpB],
    );
    await database.query('delete from auth.users where id = $1', [scenario.staff.superAdmin]);
    const [row] = await database.query<{ created_by: string | null }>(
      'select created_by from public.staff_assignments where user_id = $1',
      [scenario.staff.blockOfficer],
    );
    expect(row).toEqual({ created_by: null });
  });

  it('refuses to remove the last super administrator', async () => {
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        query('delete from auth.users where id = $1', [scenario.staff.superAdmin]),
      ),
    );
    expect(code).toBe('42501');
  });
});
