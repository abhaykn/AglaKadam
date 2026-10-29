import { beforeEach, describe, expect, it } from 'vitest';
import { handleAccountAdmin } from '../../../supabase/functions/account-admin/handler.ts';
import { callerWith, FakeAccountServices } from './support/fake-services';

let services: FakeAccountServices;

const superAdmin = callerWith({ userId: 'admin', isSuperAdmin: true });
const crp = callerWith({ userId: 'crp', crpClusterIds: ['cluster-a'] });
const teacher = callerWith({ userId: 'teacher', teacherSchoolIds: ['school-a1'] });

beforeEach(() => {
  services = new FakeAccountServices();
  services.scopes.set('cluster-a', 'crp');
  services.scopes.set('school-a1', 'teacher');
  services.schoolClusters.set('school-a1', 'cluster-a');
  services.schoolClusters.set('school-b1', 'cluster-b');
  services.addStaff('teacher-a1', 'teacher', { schoolId: 'school-a1' }, '9000000001');
  services.addStaff('teacher-b1', 'teacher', { schoolId: 'school-b1' }, '9000000002');
  services.addStaff('crp-b', 'crp', { clusterId: 'cluster-b' }, '9000000003');
  services.students.set('student-active', {
    id: 'student-active',
    schoolId: 'school-a1',
    clusterId: 'cluster-a',
    status: 'active',
    studentCode: '1234567897',
    fullName: 'Asha Kumari',
    authUserId: null,
  });
  services.students.set('student-pending', {
    id: 'student-pending',
    schoolId: 'school-a1',
    clusterId: 'cluster-a',
    status: 'pending',
    studentCode: '1000000009',
    fullName: 'Ravi',
    authUserId: null,
  });
});

const newTeacher = {
  full_name: 'Sunita Devi',
  mobile: '+91 98765 43210',
  role: 'teacher',
  scope_id: 'school-a1',
};

describe('requests', () => {
  it('rejects a body that is not an object or names an unknown action', async () => {
    expect(await handleAccountAdmin(null, superAdmin, services)).toMatchObject({ status: 400 });
    expect(
      await handleAccountAdmin({ action: 'drop_everything' }, superAdmin, services),
    ).toMatchObject({ status: 400, body: { error: { code: 'invalid_request', field: 'action' } } });
  });

  it('refuses every action to an account of a demonstration district', async () => {
    services.demonstrationAccounts.add('crp');
    const result = await handleAccountAdmin(
      { action: 'reset_staff_password', user_id: 'teacher-a1' },
      crp,
      services,
    );
    expect(result).toMatchObject({ status: 403, body: { error: { code: 'demonstration' } } });
    expect(services.calls).toEqual([]);
  });

  it('refuses family accounts', async () => {
    const family = callerWith({ accountKind: 'student' });
    expect(
      await handleAccountAdmin({ action: 'issue_family_login', student_id: 'x' }, family, services),
    ).toMatchObject({ status: 403 });
  });
});

describe('create_staff', () => {
  // Scope ids in these tests are short labels; the handler only accepts UUIDs, so real ids are used.
  const schoolId = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';

  beforeEach(() => {
    services.scopes.set(schoolId, 'teacher');
  });

  it('creates the identity with provisioning details and returns a temporary password once', async () => {
    const result = await handleAccountAdmin(
      { action: 'create_staff', accounts: [{ ...newTeacher, scope_id: schoolId }] },
      superAdmin,
      services,
    );
    expect(result.status).toBe(200);
    const [outcome] = (result.body as { results: Record<string, unknown>[] }).results;
    expect(outcome).toMatchObject({
      index: 0,
      status: 'created',
      full_name: 'Sunita Devi',
      mobile: '9876543210',
    });
    expect(outcome?.temporary_password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);

    expect(services.createdUsers).toHaveLength(1);
    expect(services.createdUsers[0]).toMatchObject({
      email: 'm9876543210@staff.agla-kadam.invalid',
      password: outcome?.temporary_password,
      appMetadata: {
        provisioning: {
          account_kind: 'staff',
          full_name: 'Sunita Devi',
          phone: '9876543210',
          provisioned_by: 'admin',
          password_change_required: true,
          assignment: { role: 'teacher', scope_id: schoolId },
        },
      },
    });
  });

  it('reports a mobile number that is already in use, including within the same request', async () => {
    const result = await handleAccountAdmin(
      {
        action: 'create_staff',
        accounts: [
          { ...newTeacher, scope_id: schoolId },
          { ...newTeacher, full_name: 'Another Person', scope_id: schoolId },
          { ...newTeacher, mobile: '9000000001', scope_id: schoolId },
        ],
      },
      superAdmin,
      services,
    );
    const { results } = result.body as { results: Record<string, unknown>[] };
    expect(results.map((entry) => entry.status)).toEqual(['created', 'failed', 'failed']);
    expect(results[1]?.error).toBe('mobile_in_use');
    expect(results[2]?.error).toBe('mobile_in_use');
  });

  it('reports a scope that does not match the role', async () => {
    const result = await handleAccountAdmin(
      {
        action: 'create_staff',
        accounts: [{ ...newTeacher, role: 'crp', scope_id: schoolId }],
      },
      superAdmin,
      services,
    );
    expect((result.body as { results: unknown[] }).results[0]).toMatchObject({
      status: 'failed',
      error: 'invalid_scope',
    });
    expect(services.createdUsers).toEqual([]);
  });

  it('names the invalid field of an account in the request', async () => {
    const result = await handleAccountAdmin(
      {
        action: 'create_staff',
        accounts: [
          { ...newTeacher, scope_id: schoolId },
          { ...newTeacher, mobile: '12345' },
        ],
      },
      superAdmin,
      services,
    );
    expect(result).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request', field: 'accounts.1.mobile' } },
    });
    expect(services.createdUsers).toEqual([]);
  });

  it('is limited to super administrators', async () => {
    const result = await handleAccountAdmin(
      { action: 'create_staff', accounts: [{ ...newTeacher, scope_id: schoolId }] },
      crp,
      services,
    );
    expect(result.status).toBe(403);
  });

  it('refuses more than one hundred accounts in one request', async () => {
    const accounts = Array.from({ length: 101 }, () => ({ ...newTeacher, scope_id: schoolId }));
    const result = await handleAccountAdmin(
      { action: 'create_staff', accounts },
      superAdmin,
      services,
    );
    expect(result.status).toBe(400);
  });
});

describe('reset_staff_password', () => {
  const teacherId = '0d2c5a7e-0f3b-4c1e-9d1a-5b8f6e2a4c11';
  const otherTeacherId = '0d2c5a7e-0f3b-4c1e-9d1a-5b8f6e2a4c12';
  const crpId = '0d2c5a7e-0f3b-4c1e-9d1a-5b8f6e2a4c13';

  beforeEach(() => {
    services.addStaff(teacherId, 'teacher', { schoolId: 'school-a1' }, '9000000011');
    services.addStaff(otherTeacherId, 'teacher', { schoolId: 'school-b1' }, '9000000012');
    services.addStaff(crpId, 'crp', { clusterId: 'cluster-b' }, '9000000013');
  });

  it('lets a super administrator reset any staff password and requires a change', async () => {
    const result = await handleAccountAdmin(
      { action: 'reset_staff_password', user_id: crpId },
      superAdmin,
      services,
    );
    expect(result.status).toBe(200);
    const { temporary_password: password } = result.body as { temporary_password: string };
    expect(services.passwords.get(crpId)).toBe(password);
    expect(services.passwordChangeRequired.get(crpId)).toBe(true);
  });

  it('lets a CRP reset the password of a teacher in the cluster only', async () => {
    expect(
      await handleAccountAdmin(
        { action: 'reset_staff_password', user_id: teacherId },
        crp,
        services,
      ),
    ).toMatchObject({ status: 200 });
    expect(
      await handleAccountAdmin(
        { action: 'reset_staff_password', user_id: otherTeacherId },
        crp,
        services,
      ),
    ).toMatchObject({ status: 403 });
    expect(
      await handleAccountAdmin({ action: 'reset_staff_password', user_id: crpId }, crp, services),
    ).toMatchObject({ status: 403 });
  });

  it('refuses teachers and self-service resets', async () => {
    expect(
      await handleAccountAdmin(
        { action: 'reset_staff_password', user_id: otherTeacherId },
        teacher,
        services,
      ),
    ).toMatchObject({ status: 403 });
    expect(
      await handleAccountAdmin(
        { action: 'reset_staff_password', user_id: teacherId },
        callerWith({ userId: teacherId, isSuperAdmin: true }),
        services,
      ),
    ).toMatchObject({ status: 409, body: { error: { code: 'cannot_change_self' } } });
  });

  it('reports an unknown account', async () => {
    const result = await handleAccountAdmin(
      { action: 'reset_staff_password', user_id: '0d2c5a7e-0f3b-4c1e-9d1a-5b8f6e2a4c99' },
      superAdmin,
      services,
    );
    expect(result.status).toBe(404);
  });
});

describe('set_staff_active', () => {
  const teacherId = '7b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41';

  beforeEach(() => {
    services.addStaff(teacherId, 'teacher', { schoolId: 'school-a1' }, '9000000021');
  });

  it('deactivates the profile first, then blocks sign-in', async () => {
    const result = await handleAccountAdmin(
      { action: 'set_staff_active', user_id: teacherId, active: false },
      superAdmin,
      services,
    );
    expect(result.status).toBe(200);
    expect(services.calls).toEqual([
      `setProfileActive:${teacherId}:false`,
      `setAuthBanned:${teacherId}:true`,
    ]);
  });

  it('leaves sign-in untouched when the database refuses the change', async () => {
    services.failNextProfileUpdate = true;
    await expect(
      handleAccountAdmin(
        { action: 'set_staff_active', user_id: teacherId, active: false },
        superAdmin,
        services,
      ),
    ).rejects.toThrow();
    expect(services.banned.has(teacherId)).toBe(false);
  });

  it('reactivates an account and lifts the block', async () => {
    await handleAccountAdmin(
      { action: 'set_staff_active', user_id: teacherId, active: false },
      superAdmin,
      services,
    );
    await handleAccountAdmin(
      { action: 'set_staff_active', user_id: teacherId, active: true },
      superAdmin,
      services,
    );
    expect(services.banned.has(teacherId)).toBe(false);
    expect(services.profiles.get(teacherId)?.isActive).toBe(true);
  });

  it('refuses to change the caller’s own account and is limited to super administrators', async () => {
    expect(
      await handleAccountAdmin(
        { action: 'set_staff_active', user_id: teacherId, active: false },
        callerWith({ userId: teacherId, isSuperAdmin: true }),
        services,
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await handleAccountAdmin(
        { action: 'set_staff_active', user_id: teacherId, active: false },
        crp,
        services,
      ),
    ).toMatchObject({ status: 403 });
  });
});

describe('change_staff_mobile', () => {
  const teacherId = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c11';

  beforeEach(() => {
    services.addStaff(teacherId, 'teacher', { schoolId: 'school-a1' }, '9000000031');
  });

  it('moves the sign-in identity and the profile to the new number', async () => {
    const result = await handleAccountAdmin(
      { action: 'change_staff_mobile', user_id: teacherId, mobile: '8000000031' },
      superAdmin,
      services,
    );
    expect(result.status).toBe(200);
    expect(services.calls).toEqual([
      `setAuthEmail:${teacherId}:m8000000031@staff.agla-kadam.invalid`,
      `setProfileMobile:${teacherId}:8000000031`,
    ]);
  });

  it('refuses a number held by another account', async () => {
    const result = await handleAccountAdmin(
      { action: 'change_staff_mobile', user_id: teacherId, mobile: '9000000001' },
      superAdmin,
      services,
    );
    expect(result).toMatchObject({ status: 409, body: { error: { code: 'mobile_in_use' } } });
    expect(services.calls).toEqual([]);
  });

  it('restores the sign-in identity when the profile cannot be updated', async () => {
    services.failNextProfileUpdate = true;
    await expect(
      handleAccountAdmin(
        { action: 'change_staff_mobile', user_id: teacherId, mobile: '8000000031' },
        superAdmin,
        services,
      ),
    ).rejects.toThrow();
    expect(services.calls.at(-1)).toBe(
      `setAuthEmail:${teacherId}:m9000000031@staff.agla-kadam.invalid`,
    );
  });
});

describe('family sign-in slips', () => {
  const activeId = '9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b61';
  const pendingId = '9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b62';

  beforeEach(() => {
    const active = services.students.get('student-active');
    const pending = services.students.get('student-pending');
    if (active && pending) {
      services.students.set(activeId, { ...active, id: activeId });
      services.students.set(pendingId, { ...pending, id: pendingId });
    }
  });

  it('lets the school’s teacher issue a slip, creating the family identity', async () => {
    const result = await handleAccountAdmin(
      { action: 'issue_family_login', student_id: activeId },
      teacher,
      services,
    );
    expect(result.status).toBe(200);
    const body = result.body as { learner_code: string; pin: string; full_name: string };
    expect(body).toMatchObject({ learner_code: '1234567897', full_name: 'Asha Kumari' });
    expect(body.pin).toMatch(/^[0-9]{6}$/);
    expect(services.createdUsers[0]).toMatchObject({
      email: 'f1234567897@family.agla-kadam.invalid',
      appMetadata: { provisioning: { account_kind: 'student', student_id: activeId } },
    });
    expect(services.familyPins.get(activeId)).toEqual({ pin: body.pin, issuedBy: 'teacher' });
  });

  it('issues a new PIN for an existing family account and lifts any block', async () => {
    const student = services.students.get(activeId);
    if (student) {
      student.authUserId = 'family-user';
    }
    services.banned.add('family-user');
    const result = await handleAccountAdmin(
      { action: 'issue_family_login', student_id: activeId },
      crp,
      services,
    );
    expect(result.status).toBe(200);
    expect(services.createdUsers).toEqual([]);
    expect(services.banned.has('family-user')).toBe(false);
  });

  it('refuses a student awaiting verification', async () => {
    const result = await handleAccountAdmin(
      { action: 'issue_family_login', student_id: pendingId },
      superAdmin,
      services,
    );
    expect(result).toMatchObject({
      status: 409,
      body: { error: { code: 'student_not_verified' } },
    });
    expect(services.familyPins.size).toBe(0);
  });

  it('refuses staff of other schools and clusters', async () => {
    for (const caller of [
      callerWith({ teacherSchoolIds: ['school-b1'] }),
      callerWith({ crpClusterIds: ['cluster-b'] }),
    ]) {
      const result = await handleAccountAdmin(
        { action: 'issue_family_login', student_id: activeId },
        caller,
        services,
      );
      expect(result.status).toBe(403);
    }
  });

  it('revokes a slip and ends the family’s sessions', async () => {
    const student = services.students.get(activeId);
    if (student) {
      student.authUserId = 'family-user';
    }
    services.familyPins.set(activeId, { pin: '482915', issuedBy: 'teacher' });
    const result = await handleAccountAdmin(
      { action: 'revoke_family_login', student_id: activeId },
      teacher,
      services,
    );
    expect(result.status).toBe(200);
    expect(services.familyPins.has(activeId)).toBe(false);
    expect(services.banned.has('family-user')).toBe(true);
  });
});

describe('findings from the security review', () => {
  const teacherId = '3c2b1a0f-9e8d-4c7b-8a69-5f4e3d2c1b01';
  const studentId = '3c2b1a0f-9e8d-4c7b-8a69-5f4e3d2c1b02';

  beforeEach(() => {
    services.addStaff(teacherId, 'teacher', { schoolId: 'school-a1' }, '9000000041');
    const active = services.students.get('student-active');
    if (active) {
      services.students.set(studentId, { ...active, id: studentId, authUserId: 'family-user' });
    }
  });

  it('refuses every action to an account still on an issued password', async () => {
    const result = await handleAccountAdmin(
      { action: 'reset_staff_password', user_id: teacherId },
      callerWith({ userId: 'admin', isSuperAdmin: true, passwordChangeRequired: true }),
      services,
    );
    expect(result).toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    expect(services.passwords.size).toBe(0);
  });

  it('does not let a CRP reset a teacher who has a promotion scheduled', async () => {
    services.addScheduledPosting(teacherId, 'super_admin');
    const result = await handleAccountAdmin(
      { action: 'reset_staff_password', user_id: teacherId },
      crp,
      services,
    );
    expect(result.status).toBe(403);
    expect(services.passwords.has(teacherId)).toBe(false);
  });

  it('switches a family account off when its sign-in is withdrawn and on when a slip is issued', async () => {
    await handleAccountAdmin(
      { action: 'revoke_family_login', student_id: studentId },
      teacher,
      services,
    );
    await handleAccountAdmin(
      { action: 'issue_family_login', student_id: studentId },
      teacher,
      services,
    );
    expect(services.calls.filter((call) => call.includes('family-user'))).toEqual([
      'setFamilyAccountActive:family-user:false',
      'setAuthBanned:family-user:true',
      'setFamilyAccountActive:family-user:true',
      'setAuthBanned:family-user:false',
    ]);
  });

  it('asks to try again when another slip for the same student is issued at the same moment', async () => {
    const student = services.students.get(studentId);
    if (student) {
      student.authUserId = null;
    }
    services.nextCreateResult = { error: 'email_in_use' };
    const result = await handleAccountAdmin(
      { action: 'issue_family_login', student_id: studentId },
      teacher,
      services,
    );
    expect(result).toMatchObject({ status: 409, body: { error: { code: 'concurrent_update' } } });
  });
});
