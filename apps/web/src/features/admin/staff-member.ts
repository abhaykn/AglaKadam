import type { StaffRole } from '@/features/auth/access';

/** A staff account as the staff list shows it, with the postings that have not ended. */
export interface StaffMember {
  id: string;
  fullName: string;
  mobile: string | null;
  isActive: boolean;
  assignments: {
    id: string;
    role: StaffRole;
    scopeLabel: string;
    startsOn: string;
    endsOn: string | null;
  }[];
}

/** Postings that can be transferred: those without an end date already set. */
export function transferablePostings(member: StaffMember): StaffMember['assignments'] {
  return member.assignments.filter((assignment) => assignment.endsOn === null);
}
