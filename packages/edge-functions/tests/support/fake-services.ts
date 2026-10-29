import type {
  AccountServices,
  AssignmentRecord,
  CallerAccess,
  CreateUserResult,
  ProfileRecord,
  StaffRole,
  StudentRecord,
} from '../../../../supabase/functions/_shared/services.ts';

/**
 * In-memory stand-in for the platform. It records every call so tests can assert both the outcome
 * and the side effects (or their absence).
 */
export class FakeAccountServices implements AccountServices {
  profiles = new Map<string, ProfileRecord>();
  assignments = new Map<string, AssignmentRecord[]>();
  schoolClusters = new Map<string, string>();
  scopes = new Map<string, StaffRole>();
  students = new Map<string, StudentRecord>();
  emailsInUse = new Set<string>();
  banned = new Set<string>();
  passwords = new Map<string, string>();
  passwordChangeRequired = new Map<string, boolean>();
  familyPins = new Map<string, { pin: string; issuedBy: string }>();
  createdUsers: { email: string; password: string; appMetadata: Record<string, unknown> }[] = [];
  calls: string[] = [];
  /** When set, the next profile status change fails, as the database would for the last administrator. */
  failNextProfileUpdate = false;
  /** Result the Auth service gives for the next identity creation. */
  nextCreateResult: CreateUserResult | null = null;
  /** Accounts that belong to a demonstration district. */
  demonstrationAccounts = new Set<string>();

  isDemonstration(profileId: string): Promise<boolean> {
    return Promise.resolve(this.demonstrationAccounts.has(profileId));
  }

  addStaff(
    id: string,
    role: StaffRole,
    scope: { schoolId?: string; clusterId?: string },
    mobile: string,
  ): void {
    this.profiles.set(id, {
      id,
      accountKind: 'staff',
      fullName: `Staff ${id}`,
      mobile,
      isActive: true,
    });
    this.assignments.set(id, [
      {
        role,
        schoolId: scope.schoolId ?? null,
        clusterId: scope.clusterId ?? null,
        isCurrent: true,
      },
    ]);
  }

  /** Schedules an additional posting that starts in the future. */
  addScheduledPosting(id: string, role: StaffRole): void {
    this.assignments.set(id, [
      ...(this.assignments.get(id) ?? []),
      { role, schoolId: null, clusterId: null, isCurrent: false },
    ]);
  }

  findStaffIdByMobile(mobile: string): Promise<string | null> {
    for (const profile of this.profiles.values()) {
      if (profile.accountKind === 'staff' && profile.mobile === mobile) {
        return Promise.resolve(profile.id);
      }
    }
    return Promise.resolve(null);
  }

  scopeMatchesRole(role: StaffRole, scopeId: string | null): Promise<boolean> {
    if (role === 'super_admin') {
      return Promise.resolve(scopeId === null);
    }
    return Promise.resolve(scopeId !== null && this.scopes.get(scopeId) === role);
  }

  getProfile(userId: string): Promise<ProfileRecord | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  getOpenAssignments(userId: string): Promise<AssignmentRecord[]> {
    return Promise.resolve(this.assignments.get(userId) ?? []);
  }

  clusterOfSchool(schoolId: string): Promise<string | null> {
    return Promise.resolve(this.schoolClusters.get(schoolId) ?? null);
  }

  createAuthUser(input: {
    email: string;
    password: string;
    appMetadata: Record<string, unknown>;
  }): Promise<CreateUserResult> {
    this.calls.push(`createAuthUser:${input.email}`);
    if (this.nextCreateResult) {
      const result = this.nextCreateResult;
      this.nextCreateResult = null;
      return Promise.resolve(result);
    }
    if (this.emailsInUse.has(input.email)) {
      return Promise.resolve({ error: 'email_in_use' });
    }
    this.emailsInUse.add(input.email);
    this.createdUsers.push(input);
    const id = `user-${String(this.createdUsers.length)}`;
    const provisioning = input.appMetadata.provisioning as Record<string, unknown> | undefined;
    if (provisioning?.account_kind === 'staff') {
      this.profiles.set(id, {
        id,
        accountKind: 'staff',
        fullName: String(provisioning.full_name),
        mobile: String(provisioning.phone),
        isActive: true,
      });
    }
    return Promise.resolve({ id });
  }

  setAuthPassword(userId: string, password: string): Promise<void> {
    this.calls.push(`setAuthPassword:${userId}`);
    this.passwords.set(userId, password);
    return Promise.resolve();
  }

  setAuthEmail(userId: string, email: string): Promise<void> {
    this.calls.push(`setAuthEmail:${userId}:${email}`);
    return Promise.resolve();
  }

  setAuthBanned(userId: string, banned: boolean): Promise<void> {
    this.calls.push(`setAuthBanned:${userId}:${String(banned)}`);
    if (banned) {
      this.banned.add(userId);
    } else {
      this.banned.delete(userId);
    }
    return Promise.resolve();
  }

  setPasswordChangeRequired(userId: string, required: boolean): Promise<void> {
    this.passwordChangeRequired.set(userId, required);
    return Promise.resolve();
  }

  setProfileActive(userId: string, active: boolean): Promise<void> {
    this.calls.push(`setProfileActive:${userId}:${String(active)}`);
    if (this.failNextProfileUpdate) {
      this.failNextProfileUpdate = false;
      return Promise.reject(
        new Error('The last active super administrator cannot be deactivated.'),
      );
    }
    const profile = this.profiles.get(userId);
    if (profile) {
      profile.isActive = active;
    }
    return Promise.resolve();
  }

  setProfileMobile(userId: string, mobile: string): Promise<void> {
    this.calls.push(`setProfileMobile:${userId}:${mobile}`);
    if (this.failNextProfileUpdate) {
      this.failNextProfileUpdate = false;
      return Promise.reject(new Error('duplicate key value violates unique constraint'));
    }
    const profile = this.profiles.get(userId);
    if (profile) {
      profile.mobile = mobile;
    }
    return Promise.resolve();
  }

  setFamilyAccountActive(userId: string, active: boolean): Promise<void> {
    this.calls.push(`setFamilyAccountActive:${userId}:${String(active)}`);
    return Promise.resolve();
  }

  getStudent(studentId: string): Promise<StudentRecord | null> {
    return Promise.resolve(this.students.get(studentId) ?? null);
  }

  setFamilyPin(studentId: string, pin: string, issuedBy: string): Promise<void> {
    this.familyPins.set(studentId, { pin, issuedBy });
    return Promise.resolve();
  }

  revokeFamilyPin(studentId: string): Promise<void> {
    this.calls.push(`revokeFamilyPin:${studentId}`);
    this.familyPins.delete(studentId);
    return Promise.resolve();
  }
}

export function callerWith(overrides: Partial<CallerAccess> = {}): CallerAccess {
  return {
    userId: 'caller',
    accountKind: 'staff',
    mobile: '9876500000',
    passwordChangeRequired: false,
    isSuperAdmin: false,
    teacherSchoolIds: [],
    crpClusterIds: [],
    ...overrides,
  };
}
