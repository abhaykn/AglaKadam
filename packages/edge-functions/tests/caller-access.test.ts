import { describe, expect, it } from 'vitest';
import { callerFromAccess } from '../../../supabase/functions/_shared/services.ts';

describe('callerFromAccess', () => {
  it('collects the roles and scopes of an active staff account', () => {
    expect(
      callerFromAccess({
        user_id: 'u1',
        account_kind: 'staff',
        phone: '9876543210',
        is_active: true,
        assignments: [
          { role: 'super_admin', scope: null },
          { role: 'teacher', scope: { type: 'school', id: 's1' } },
          { role: 'crp', scope: { type: 'cluster', id: 'c1' } },
          { role: 'block_officer', scope: { type: 'block', id: 'b1' } },
        ],
      }),
    ).toEqual({
      userId: 'u1',
      accountKind: 'staff',
      mobile: '9876543210',
      passwordChangeRequired: false,
      isSuperAdmin: true,
      teacherSchoolIds: ['s1'],
      crpClusterIds: ['c1'],
    });
  });

  it('returns null for missing, inactive or malformed access', () => {
    expect(callerFromAccess(null)).toBeNull();
    expect(
      callerFromAccess({ user_id: 'u1', account_kind: 'staff', is_active: false, assignments: [] }),
    ).toBeNull();
    expect(callerFromAccess({ user_id: 'u1', account_kind: 'robot', is_active: true })).toBeNull();
  });

  it('ignores a role whose scope does not match it', () => {
    const caller = callerFromAccess({
      user_id: 'u1',
      account_kind: 'staff',
      is_active: true,
      assignments: [{ role: 'teacher', scope: { type: 'cluster', id: 'c1' } }],
    });
    expect(caller?.teacherSchoolIds).toEqual([]);
  });
});
