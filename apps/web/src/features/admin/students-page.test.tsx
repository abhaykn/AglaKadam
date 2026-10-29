import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import type * as AdminApi from './admin-api';
import { StudentsPage } from './students-page';

const api = vi.hoisted(() => ({
  fetchStudents: vi.fn(),
  issueFamilyLogin: vi.fn(),
}));

vi.mock('./admin-api', async (original) => ({
  ...(await original<typeof AdminApi>()),
  fetchAcademicYears: () => Promise.resolve([]),
  fetchStudents: api.fetchStudents,
  importStudents: vi.fn(),
  issueFamilyLogin: api.issueFamilyLogin,
  revokeFamilyLogin: vi.fn(),
}));
// The school is chosen directly; the picker is tested with its own page.
vi.mock('./scope-picker', () => ({
  ScopePicker: ({ onChange }: { onChange: (school: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange({ id: 'school-1', code: '09010100101', name: 'Rampur', context: 'Block A' })
      }
    >
      Choose Rampur
    </button>
  ),
}));

function student(id: string, fullName: string, familySignIn: boolean) {
  return {
    id,
    full_name: fullName,
    student_code: '1000000008',
    admission_number: null,
    gender: 'female',
    status: 'active',
    has_special_needs: false,
    family_sign_in_active: familySignIn,
    enrolments: [],
  };
}

async function openActions(name: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StudentsPage />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Choose Rampur' }));
  await userEvent.click(
    await screen.findByRole('button', {
      name: en.admin.staff.actionsFor.replace('{{name}}', name),
    }),
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('family sign-in slips', () => {
  it('asks before a new PIN replaces the one a family uses', async () => {
    api.fetchStudents.mockResolvedValue({ rows: [student('s-1', 'Asha', true)], total: 1 });
    api.issueFamilyLogin.mockResolvedValue({
      student_id: 's-1',
      full_name: 'Asha',
      learner_code: '1000000008',
      pin: '482913',
    });
    await openActions('Asha');
    await userEvent.click(screen.getByRole('menuitem', { name: en.admin.students.reissueSlip }));
    expect(await screen.findByText(en.admin.students.reissueTitle)).toBeInTheDocument();
    expect(api.issueFamilyLogin).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: en.admin.students.reissueSlip }));
    await waitFor(() => expect(api.issueFamilyLogin).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText('482913')).length).toBeGreaterThan(0);
  });

  it('issues a first slip at once', async () => {
    api.fetchStudents.mockResolvedValue({ rows: [student('s-2', 'Bilal', false)], total: 1 });
    api.issueFamilyLogin.mockResolvedValue({
      student_id: 's-2',
      full_name: 'Bilal',
      learner_code: '1000000016',
      pin: '305718',
    });
    await openActions('Bilal');
    await userEvent.click(screen.getByRole('menuitem', { name: en.admin.students.issueSlip }));
    await waitFor(() => expect(api.issueFamilyLogin).toHaveBeenCalledWith('s-2'));
    expect(screen.queryByText(en.admin.students.reissueTitle)).toBeNull();
  });
});
