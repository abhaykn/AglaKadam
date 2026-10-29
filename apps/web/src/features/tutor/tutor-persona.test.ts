import { describe, expect, it } from 'vitest';
import type { Access } from '@/features/auth/access';
import { workspaceInUse } from './tutor-persona';

function access(overrides: Partial<Access>): Access {
  return {
    user_id: 'u1',
    account_kind: 'staff',
    full_name: 'Someone',
    preferred_language: 'en',
    phone: null,
    is_active: true,
    password_change_required: false,
    assignments: [],
    student: null,
    ...overrides,
  };
}

const assignment = (role: 'crp' | 'teacher') => ({
  id: role,
  role,
  starts_on: '2026-01-01',
  ends_on: null,
  scope: null,
});

describe('the kind of person Disha speaks to', () => {
  const both = access({ assignments: [assignment('crp'), assignment('teacher')] });

  it('follows the workspace being used', () => {
    expect(workspaceInUse('/app/teacher', both)).toBe('teacher');
    expect(workspaceInUse('/app/teacher/attendance', both)).toBe('teacher');
    expect(workspaceInUse('/app/crp/rehearse', both)).toBe('crp');
  });

  it('falls back to the first workspace on other pages', () => {
    expect(workspaceInUse('/app/account', both)).toBe('crp');
    expect(workspaceInUse('/app/teachers-lounge', both)).toBe('crp');
  });

  it('speaks to a family as a family and to nobody without a workspace', () => {
    const child = access({
      account_kind: 'student',
      student: {
        id: 's',
        full_name: 'A Child',
        student_code: '1234567890',
        school: null,
        class: null,
      },
    });
    expect(workspaceInUse('/app/family', child)).toBe('family');
    expect(workspaceInUse('/app', access({}))).toBeNull();
  });
});
