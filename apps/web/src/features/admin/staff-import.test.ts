import { describe, expect, it } from 'vitest';
import { validateStaffRows } from './staff-import';

describe('validateStaffRows', () => {
  it('accepts valid rows and normalises mobile numbers, roles and codes', () => {
    const { rows, problems } = validateStaffRows([
      {
        full_name: 'Sunita Devi',
        mobile: '+91 98765 43210',
        role: 'Teacher',
        scope_code: '09010100101',
      },
      {
        full_name: 'Ramesh Kumar',
        mobile: '9876500001',
        role: 'crp',
        scope_code: 'ab12',
        preferred_language: 'EN',
      },
      { full_name: 'Platform Administrator', mobile: '9876500002', role: 'super_admin' },
    ]);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        row: 1,
        fullName: 'Sunita Devi',
        mobile: '9876543210',
        role: 'teacher',
        scopeCode: '09010100101',
        language: 'hi',
        startsOn: null,
      },
      {
        row: 2,
        fullName: 'Ramesh Kumar',
        mobile: '9876500001',
        role: 'crp',
        scopeCode: 'AB12',
        language: 'en',
        startsOn: null,
      },
      {
        row: 3,
        fullName: 'Platform Administrator',
        mobile: '9876500002',
        role: 'super_admin',
        scopeCode: null,
        language: 'hi',
        startsOn: null,
      },
    ]);
  });

  it('reports every problem with its row', () => {
    const { rows, problems } = validateStaffRows([
      { full_name: '', mobile: '12345', role: 'principal' },
      { full_name: 'A', mobile: '9876500003', role: 'teacher', starts_on: '2026-02-30' },
      {
        full_name: 'B',
        mobile: '9876500004',
        role: 'crp',
        scope_code: 'C1',
        preferred_language: 'fr',
      },
      { full_name: 'C', mobile: '9876500004', role: 'crp', scope_code: 'C1' },
    ]);
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([
      { row: 1, field: 'full_name', issue: 'required' },
      { row: 1, field: 'mobile', issue: 'format' },
      { row: 1, field: 'role', issue: 'format' },
      { row: 2, field: 'scope_code', issue: 'required' },
      { row: 2, field: 'starts_on', issue: 'format' },
      { row: 3, field: 'mobile', issue: 'duplicate' },
      { row: 3, field: 'preferred_language', issue: 'format' },
      { row: 4, field: 'mobile', issue: 'duplicate' },
    ]);
  });
});
