import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, owner, type TestDatabase } from './support/database';
import {
  asUser,
  createAuthIdentity,
  createScenario,
  provisionStaff,
  type Scenario,
} from './support/scenario';

let database: TestDatabase;
let scenario: Scenario;
let learnerCode: string;

beforeAll(async () => {
  database = await createTestDatabase();
  scenario = await createScenario(database);
  const [row] = await database.query<{ student_code: string }>(
    'select student_code from public.students where id = $1',
    [scenario.students.a1Active[0]],
  );
  learnerCode = row?.student_code ?? '';
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

const service = { kind: 'service' } as const;

interface VerifyResult {
  status: 'ok' | 'invalid' | 'locked';
  user_id?: string;
  retry_after_seconds?: number;
}

async function setPin(pin: string): Promise<void> {
  await database.as(service, (query) =>
    query('select public.service_set_family_pin($1, $2, $3)', [
      scenario.students.a1Active[0],
      pin,
      scenario.staff.crpA,
    ]),
  );
}

async function verify(code: string, pin: string, client = 'client-a'): Promise<VerifyResult> {
  const [row] = await database.as(service, (query) =>
    query<{ result: VerifyResult }>(
      'select public.service_verify_family_pin($1, $2, $3) as result',
      [code, pin, client],
    ),
  );
  if (!row) {
    throw new Error('No result returned.');
  }
  return row.result;
}

describe('family PIN sign-in', () => {
  it('accepts the right PIN and identifies the family account', async () => {
    await setPin('482915');
    expect(await verify(learnerCode, '482915')).toEqual({
      status: 'ok',
      user_id: scenario.familyAccountId,
    });
  });

  it('stores only a bcrypt hash of the PIN', async () => {
    await setPin('482915');
    const [row] = await database.query<{ pin_hash: string }>(
      'select pin_hash from private.family_credentials where student_id = $1',
      [scenario.students.a1Active[0]],
    );
    expect(row?.pin_hash).toMatch(/^\$2a\$10\$/);
    expect(row?.pin_hash).not.toContain('482915');
  });

  it('gives the same answer for an unknown code and a wrong PIN', async () => {
    await setPin('482915');
    expect(await verify(learnerCode, '000000')).toEqual({ status: 'invalid' });
    expect(await verify('1000000009', '482915')).toEqual({ status: 'invalid' });
    expect(await verify('not-a-code', 'abc')).toEqual({ status: 'invalid' });
  });

  it('locks after five consecutive failures and refuses even the right PIN while locked', async () => {
    await setPin('482915');
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await verify(learnerCode, '111111')).status).toBe('invalid');
    }
    const fifth = await verify(learnerCode, '111111');
    expect(fifth.status).toBe('locked');
    expect(fifth.retry_after_seconds).toBeGreaterThan(14 * 60);
    expect(fifth.retry_after_seconds).toBeLessThanOrEqual(15 * 60);
    expect((await verify(learnerCode, '482915')).status).toBe('locked');
  });

  it('doubles the lock for each further failure after a lock expires', async () => {
    await setPin('482915');
    await database.query(
      `update private.family_credentials
       set failed_attempts = 5, locked_until = now() - interval '1 second',
           last_failed_at = now() - interval '16 minutes'
       where student_id = $1`,
      [scenario.students.a1Active[0]],
    );
    const result = await verify(learnerCode, '111111');
    expect(result.status).toBe('locked');
    expect(result.retry_after_seconds).toBeGreaterThan(29 * 60);
  });

  it('forgets failures after a day, so an occasional slip never adds up to a lock', async () => {
    await setPin('482915');
    await database.query(
      `update private.family_credentials
       set failed_attempts = 6, locked_until = now() - interval '1 day',
           last_failed_at = now() - interval '25 hours'
       where student_id = $1`,
      [scenario.students.a1Active[0]],
    );
    expect((await verify(learnerCode, '111111')).status).toBe('invalid');
    const [row] = await database.query<{ failed_attempts: number }>(
      'select failed_attempts from private.family_credentials where student_id = $1',
      [scenario.students.a1Active[0]],
    );
    expect(row?.failed_attempts).toBe(1);
  });

  it('locks an unknown code exactly as a known one, so a lock never shows that a code exists', async () => {
    const unknown = '1000000017';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await verify(unknown, '111111')).toEqual({ status: 'invalid' });
    }
    const fifth = await verify(unknown, '111111');
    expect(fifth.status).toBe('locked');
    expect(fifth.retry_after_seconds).toBeGreaterThan(14 * 60);
    expect(fifth.retry_after_seconds).toBeLessThanOrEqual(15 * 60);
    expect((await verify(unknown, '482915')).status).toBe('locked');
    // Only a hash of the code is kept.
    const rows = await database.query<{ hashed_code: string }>(
      'select hashed_code from private.family_sign_in_decoys',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hashed_code).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.hashed_code).not.toContain(unknown);
  });

  it('clears the failure count after a successful sign-in', async () => {
    await setPin('482915');
    await verify(learnerCode, '111111');
    await verify(learnerCode, '482915');
    const [row] = await database.query<{ failed_attempts: number; signed_in: boolean }>(
      `select failed_attempts, last_sign_in_at is not null as signed_in
       from private.family_credentials where student_id = $1`,
      [scenario.students.a1Active[0]],
    );
    expect(row).toEqual({ failed_attempts: 0, signed_in: true });
  });

  it('issuing a new PIN replaces the old one and lifts a lock', async () => {
    await setPin('482915');
    await database.query(
      `update private.family_credentials set failed_attempts = 9, locked_until = now() + interval '1 hour'
       where student_id = $1`,
      [scenario.students.a1Active[0]],
    );
    await setPin('730261');
    expect((await verify(learnerCode, '482915')).status).toBe('invalid');
    expect((await verify(learnerCode, '730261')).status).toBe('ok');
  });

  it('refuses a deactivated family account', async () => {
    await setPin('482915');
    await database.query('update public.profiles set is_active = false where id = $1', [
      scenario.familyAccountId,
    ]);
    expect((await verify(learnerCode, '482915')).status).toBe('invalid');
  });

  it('can be revoked', async () => {
    await setPin('482915');
    await database.as(service, (query) =>
      query('select public.service_revoke_family_pin($1)', [scenario.students.a1Active[0]]),
    );
    expect((await verify(learnerCode, '482915')).status).toBe('invalid');
  });

  it('rejects a PIN that is not six digits', async () => {
    const code = await errorCodeOf(
      database.as(service, (query) =>
        query('select public.service_set_family_pin($1, $2, null)', [
          scenario.students.a1Active[0],
          '1234',
        ]),
      ),
    );
    expect(code).toBe('22023');
  });

  it('is unavailable to signed-in users and visitors', async () => {
    for (const identity of [asUser(scenario.staff.superAdmin), { kind: 'anon' } as const]) {
      const code = await errorCodeOf(
        database.as(identity, (query) =>
          query(`select public.service_verify_family_pin('1234567890', '123456', 'client-a')`),
        ),
      );
      expect(code).toBe('42501');
    }
  });
});

describe('password change requirement', () => {
  it('is set for newly provisioned staff and can be waived by the provisioning service', async () => {
    const required = await createAuthIdentity(database.query, {
      provisioning: {
        account_kind: 'staff',
        full_name: 'New Teacher',
        assignment: { role: 'teacher', scope_id: scenario.schoolA2Id },
      },
    });
    const waived = await createAuthIdentity(database.query, {
      provisioning: {
        account_kind: 'staff',
        full_name: 'Imported Teacher',
        password_change_required: false,
        assignment: { role: 'teacher', scope_id: scenario.schoolA2Id },
      },
    });
    const rows = await database.query<{ id: string; password_change_required: boolean }>(
      'select id, password_change_required from public.profiles where id = any ($1::uuid[])',
      [[required, waived]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.password_change_required]))).toEqual({
      [required]: true,
      [waived]: false,
    });
  });

  it('cannot be cleared by the user, even an administrator', async () => {
    await database.query(
      'update public.profiles set password_change_required = true where id = $1',
      [scenario.staff.teacherA1],
    );
    for (const userId of [scenario.staff.teacherA1, scenario.staff.superAdmin]) {
      const code = await errorCodeOf(
        database.as(asUser(userId), (query) =>
          query('update public.profiles set password_change_required = false where id = $1', [
            scenario.staff.teacherA1,
          ]),
        ),
      );
      expect(code).toBe('42501');
    }
  });

  it('is cleared by the password service', async () => {
    await database.query(
      'update public.profiles set password_change_required = true where id = $1',
      [scenario.staff.teacherA1],
    );
    const rows = await database.as(service, (query) =>
      query<{ password_change_required: boolean }>(
        `update public.profiles set password_change_required = false where id = $1
         returning password_change_required`,
        [scenario.staff.teacherA1],
      ),
    );
    expect(rows).toEqual([{ password_change_required: false }]);
  });
});

describe('staff mobile numbers', () => {
  it('identify exactly one staff account', async () => {
    await database.query(`update public.profiles set phone = '9876500001' where id = $1`, [
      scenario.staff.teacherA1,
    ]);
    const code = await errorCodeOf(
      database.as(owner, (query) =>
        query(`update public.profiles set phone = '9876500001' where id = $1`, [
          scenario.staff.teacherA2,
        ]),
      ),
    );
    expect(code).toBe('23505');
  });

  it('can only be changed by an administrator', async () => {
    const code = await errorCodeOf(
      database.as(asUser(scenario.staff.teacherA1), (query) =>
        query(`update public.profiles set phone = '9876500002' where id = $1`, [
          scenario.staff.teacherA1,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });
});

describe('my_access', () => {
  interface Access {
    account_kind: string;
    full_name: string;
    password_change_required: boolean;
    assignments: { role: string; scope: { type: string; id: string } | null }[];
    student: {
      id: string;
      student_code: string;
      school: { id: string };
      class: { id: string };
    } | null;
  }

  async function accessOf(userId: string): Promise<Access | null> {
    const [row] = await database.as(asUser(userId), (query) =>
      query<{ access: Access | null }>('select public.my_access() as access'),
    );
    return row?.access ?? null;
  }

  it('describes a teacher with the school as scope', async () => {
    const access = await accessOf(scenario.staff.teacherA1);
    expect(access).toMatchObject({
      account_kind: 'staff',
      full_name: 'Teacher A1',
      password_change_required: false,
      assignments: [{ role: 'teacher', scope: { type: 'school', id: scenario.schoolA1Id } }],
      student: null,
    });
  });

  it('describes a super administrator without a scope', async () => {
    const access = await accessOf(scenario.staff.superAdmin);
    expect(access?.assignments).toMatchObject([{ role: 'super_admin', scope: null }]);
  });

  it('describes a block officer with the block as scope', async () => {
    const access = await accessOf(scenario.staff.blockOfficer);
    expect(access?.assignments).toMatchObject([
      { role: 'block_officer', scope: { type: 'block', id: scenario.northBlockId } },
    ]);
  });

  it('describes a family account with the child, school and class', async () => {
    const access = await accessOf(scenario.familyAccountId);
    expect(access).toMatchObject({
      account_kind: 'student',
      assignments: [],
      student: {
        id: scenario.students.a1Active[0],
        school: { id: scenario.schoolA1Id },
        class: { id: scenario.classA1Grade1Id },
      },
    });
  });

  it('lists no assignments for a deactivated account', async () => {
    await database.query('update public.profiles set is_active = false where id = $1', [
      scenario.staff.crpA,
    ]);
    const access = await accessOf(scenario.staff.crpA);
    expect(access?.assignments).toEqual([]);
  });

  it('returns nothing for an identity without a profile', async () => {
    const strangerId = await createAuthIdentity(database.query, {});
    expect(await accessOf(strangerId)).toBeNull();
  });
});

describe('accounts on an issued password', () => {
  it('see no records until the owner has chosen a password', async () => {
    const teacherId = await provisionStaff(database.query, {
      fullName: 'Waiting Teacher',
      role: 'teacher',
      scopeId: scenario.schoolA1Id,
      passwordChangeRequired: true,
    });

    const before = await database.as(asUser(teacherId), async (query) => ({
      schools: await query('select id from public.schools'),
      students: await query('select id from public.students'),
      access: await query<{ access: { assignments: { role: string; scope: unknown }[] } }>(
        'select public.my_access() as access',
      ),
    }));
    expect(before.schools).toEqual([]);
    expect(before.students).toEqual([]);
    // The role is still known, so the application can ask for a new password.
    expect(before.access[0]?.access.assignments).toMatchObject([{ role: 'teacher', scope: null }]);

    await database.as(service, (query) =>
      query('update public.profiles set password_change_required = false where id = $1', [
        teacherId,
      ]),
    );
    const after = await database.as(asUser(teacherId), (query) =>
      query('select id from public.schools'),
    );
    expect(after).toEqual([{ id: scenario.schoolA1Id }]);
  });
});

describe('family sign-in throttling', () => {
  it('pauses a client network after thirty failures within an hour', async () => {
    await setPin('482915');
    // Many made-up codes, one try each.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await verify(String(2000000000 + attempt), '111111', 'busy-network');
      expect(result.status).toBe('invalid');
    }
    const throttled = await verify(learnerCode, '482915', 'busy-network');
    expect(throttled.status).toBe('throttled');
    expect(throttled.retry_after_seconds).toBeGreaterThan(59 * 60);

    // Other networks are not affected, and the correct PIN still works from them.
    expect(await verify(learnerCode, '482915', 'home-network')).toEqual({
      status: 'ok',
      user_id: scenario.familyAccountId,
    });
  });

  it('starts a fresh window after an hour', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await verify(String(3000000000 + attempt), '111111', 'old-network');
    }
    await database.query(
      `update private.family_sign_in_throttle
       set window_started_at = now() - interval '61 minutes' where client_key = 'old-network'`,
    );
    expect((await verify('3000000099', '111111', 'old-network')).status).toBe('invalid');
    const [row] = await database.query<{ failures: number }>(
      `select failures from private.family_sign_in_throttle where client_key = 'old-network'`,
    );
    expect(row?.failures).toBe(1);
  });
});
