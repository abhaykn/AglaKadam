import {
  familyEmailForLearnerCode,
  generatePin,
  generateTemporaryPassword,
  generateUnusablePassword,
  MOBILE_PATTERN,
  normaliseMobile,
  staffEmailForMobile,
} from '../_shared/accounts.ts';
import {
  failure,
  type HandlerResult,
  isRecord,
  ok,
  readArray,
  readBoolean,
  readOneOf,
  readOptionalDate,
  readOptionalUuid,
  readString,
  readUuid,
  RequestError,
  respondTo,
} from '../_shared/http.ts';
import {
  type AccountServices,
  type CallerAccess,
  STAFF_ROLES,
  type StaffRole,
} from '../_shared/services.ts';

/**
 * Account administration.
 *
 * | action                 | who may call                                                   |
 * | ---------------------- | -------------------------------------------------------------- |
 * | create_staff           | super administrators                                           |
 * | reset_staff_password   | super administrators; a CRP for teachers of the cluster        |
 * | set_staff_active       | super administrators                                           |
 * | change_staff_mobile    | super administrators                                           |
 * | issue_family_login     | super administrators; the CRP and teachers of the school       |
 * | revoke_family_login    | super administrators; the CRP and teachers of the school       |
 *
 * Temporary passwords and PINs are returned once, to be printed or read out, and are never stored
 * in readable form.
 */

const ACTIONS = [
  'create_staff',
  'reset_staff_password',
  'set_staff_active',
  'change_staff_mobile',
  'issue_family_login',
  'revoke_family_login',
] as const;

const MAX_ACCOUNTS_PER_REQUEST = 100;

interface StaffDraft {
  fullName: string;
  mobile: string;
  role: StaffRole;
  scopeId: string | null;
  preferredLanguage: 'en' | 'hi';
  startsOn: string | null;
}

function readMobile(source: Record<string, unknown>, field: string): string {
  const raw = readString(source, field, { maxLength: 20 });
  const mobile = normaliseMobile(raw);
  if (!mobile) {
    throw new RequestError('invalid_request', field);
  }
  return mobile;
}

function readStaffDraft(value: unknown): StaffDraft {
  if (!isRecord(value)) {
    throw new RequestError('invalid_request');
  }
  return {
    fullName: readString(value, 'full_name', { maxLength: 120 }),
    mobile: readMobile(value, 'mobile'),
    role: readOneOf(value, 'role', STAFF_ROLES),
    scopeId: readOptionalUuid(value, 'scope_id'),
    preferredLanguage:
      value['preferred_language'] === undefined
        ? 'hi'
        : readOneOf(value, 'preferred_language', ['en', 'hi'] as const),
    startsOn: readOptionalDate(value, 'starts_on'),
  };
}

type StaffOutcome =
  | {
      status: 'created';
      user_id: string;
      full_name: string;
      mobile: string;
      temporary_password: string;
    }
  | { status: 'failed'; error: 'mobile_in_use' | 'invalid_scope' | 'rejected' };

async function createStaff(
  draft: StaffDraft,
  caller: CallerAccess,
  services: AccountServices,
): Promise<StaffOutcome> {
  if (await services.findStaffIdByMobile(draft.mobile)) {
    return { status: 'failed', error: 'mobile_in_use' };
  }
  if (!(await services.scopeMatchesRole(draft.role, draft.scopeId))) {
    return { status: 'failed', error: 'invalid_scope' };
  }

  const temporaryPassword = generateTemporaryPassword();
  const created = await services.createAuthUser({
    email: staffEmailForMobile(draft.mobile),
    password: temporaryPassword,
    appMetadata: {
      provisioning: {
        account_kind: 'staff',
        full_name: draft.fullName,
        phone: draft.mobile,
        preferred_language: draft.preferredLanguage,
        provisioned_by: caller.userId,
        password_change_required: true,
        assignment: {
          role: draft.role,
          scope_id: draft.role === 'super_admin' ? null : draft.scopeId,
          ...(draft.startsOn ? { starts_on: draft.startsOn } : {}),
        },
      },
    },
  });

  if ('error' in created) {
    return {
      status: 'failed',
      error: created.error === 'email_in_use' ? 'mobile_in_use' : 'rejected',
    };
  }
  return {
    status: 'created',
    user_id: created.id,
    full_name: draft.fullName,
    mobile: draft.mobile,
    temporary_password: temporaryPassword,
  };
}

/**
 * Whether a CRP may manage the account: a current teacher at a school of the CRP's clusters with no
 * other role, now or scheduled. A teacher about to be promoted (for example to administrator) is
 * left to administrators, so a CRP cannot take over an account that is about to gain more access.
 */
async function crpManagesTeacher(
  caller: CallerAccess,
  userId: string,
  services: AccountServices,
): Promise<boolean> {
  if (caller.crpClusterIds.length === 0) {
    return false;
  }
  const assignments = await services.getOpenAssignments(userId);
  if (assignments.length === 0 || assignments.some((assignment) => assignment.role !== 'teacher')) {
    return false;
  }
  for (const assignment of assignments) {
    if (!assignment.isCurrent || !assignment.schoolId) {
      continue;
    }
    const clusterId = await services.clusterOfSchool(assignment.schoolId);
    if (clusterId && caller.crpClusterIds.includes(clusterId)) {
      return true;
    }
  }
  return false;
}

/** Whether the caller may issue or revoke a family sign-in for the student. */
function managesFamilyOf(
  caller: CallerAccess,
  student: { schoolId: string; clusterId: string },
): boolean {
  return (
    caller.isSuperAdmin ||
    caller.crpClusterIds.includes(student.clusterId) ||
    caller.teacherSchoolIds.includes(student.schoolId)
  );
}

export function handleAccountAdmin(
  body: unknown,
  caller: CallerAccess,
  services: AccountServices,
): Promise<HandlerResult> {
  return respondTo(async () => {
    if (!isRecord(body)) {
      throw new RequestError('invalid_request');
    }
    // Accounts still on an administrator-issued password may only change their password.
    if (caller.accountKind !== 'staff' || caller.passwordChangeRequired) {
      return failure(403, 'forbidden');
    }
    const action = readOneOf(body, 'action', ACTIONS);
    // Accounts made here would outlive a demonstration district, and a reset password would lock
    // its visitor out of a role.
    if (await services.isDemonstration(caller.userId)) {
      return failure(403, 'demonstration');
    }

    switch (action) {
      case 'create_staff': {
        if (!caller.isSuperAdmin) {
          return failure(403, 'forbidden');
        }
        const drafts = readArray(body, 'accounts', { min: 1, max: MAX_ACCOUNTS_PER_REQUEST }).map(
          (value, index) => {
            try {
              return readStaffDraft(value);
            } catch (error) {
              if (error instanceof RequestError) {
                throw new RequestError(error.code, `accounts.${index}.${error.field ?? ''}`);
              }
              throw error;
            }
          },
        );
        // Accounts are created one after another so that a duplicate mobile number within the same
        // request is detected like any other.
        const results: (StaffOutcome & { index: number })[] = [];
        for (const [index, draft] of drafts.entries()) {
          results.push({ index, ...(await createStaff(draft, caller, services)) });
        }
        return ok({ results });
      }

      case 'reset_staff_password': {
        const userId = readUuid(body, 'user_id');
        if (userId === caller.userId) {
          return failure(409, 'cannot_change_self');
        }
        const profile = await services.getProfile(userId);
        if (!profile || profile.accountKind !== 'staff') {
          return failure(404, 'not_found');
        }
        if (!caller.isSuperAdmin && !(await crpManagesTeacher(caller, userId, services))) {
          return failure(403, 'forbidden');
        }
        const temporaryPassword = generateTemporaryPassword();
        await services.setAuthPassword(userId, temporaryPassword);
        await services.setPasswordChangeRequired(userId, true);
        return ok({ user_id: userId, temporary_password: temporaryPassword });
      }

      case 'set_staff_active': {
        if (!caller.isSuperAdmin) {
          return failure(403, 'forbidden');
        }
        const userId = readUuid(body, 'user_id');
        const active = readBoolean(body, 'active');
        if (userId === caller.userId) {
          return failure(409, 'cannot_change_self');
        }
        const profile = await services.getProfile(userId);
        if (!profile || profile.accountKind !== 'staff') {
          return failure(404, 'not_found');
        }
        // The profile changes first: if the database refuses (for example for the last super
        // administrator), the sign-in identity is left untouched.
        await services.setProfileActive(userId, active);
        await services.setAuthBanned(userId, !active);
        return ok({ user_id: userId, active });
      }

      case 'change_staff_mobile': {
        if (!caller.isSuperAdmin) {
          return failure(403, 'forbidden');
        }
        const userId = readUuid(body, 'user_id');
        const mobile = readMobile(body, 'mobile');
        const profile = await services.getProfile(userId);
        if (!profile || profile.accountKind !== 'staff') {
          return failure(404, 'not_found');
        }
        if (profile.mobile === mobile) {
          return ok({ user_id: userId, mobile });
        }
        const holder = await services.findStaffIdByMobile(mobile);
        if (holder && holder !== userId) {
          return failure(409, 'mobile_in_use');
        }
        await services.setAuthEmail(userId, staffEmailForMobile(mobile));
        try {
          await services.setProfileMobile(userId, mobile);
        } catch (error) {
          // Keep the sign-in identity and the profile consistent.
          if (profile.mobile && MOBILE_PATTERN.test(profile.mobile)) {
            await services.setAuthEmail(userId, staffEmailForMobile(profile.mobile));
          }
          throw error;
        }
        return ok({ user_id: userId, mobile });
      }

      case 'issue_family_login': {
        const studentId = readUuid(body, 'student_id');
        const student = await services.getStudent(studentId);
        if (!student) {
          return failure(404, 'not_found');
        }
        if (!managesFamilyOf(caller, student)) {
          return failure(403, 'forbidden');
        }
        if (student.status !== 'active') {
          return failure(409, 'student_not_verified');
        }

        if (student.authUserId) {
          await services.setFamilyAccountActive(student.authUserId, true);
          await services.setAuthBanned(student.authUserId, false);
        } else {
          const created = await services.createAuthUser({
            email: familyEmailForLearnerCode(student.studentCode),
            password: generateUnusablePassword(),
            appMetadata: {
              provisioning: { account_kind: 'student', student_id: student.id },
            },
          });
          if ('error' in created) {
            // The database refuses the link when the student is no longer verified or already has an
            // account (for example after a concurrent request); an orphaned identity cannot occur,
            // because provisioning commits together with the identity.
            // `email_in_use` means another slip for the same student was issued at the same
            // moment; the person can simply try again.
            return created.error === 'rejected'
              ? failure(409, 'student_not_verified')
              : failure(409, 'concurrent_update');
          }
        }

        const pin = generatePin();
        await services.setFamilyPin(student.id, pin, caller.userId);
        return ok({
          student_id: student.id,
          full_name: student.fullName,
          learner_code: student.studentCode,
          pin,
        });
      }

      case 'revoke_family_login': {
        const studentId = readUuid(body, 'student_id');
        const student = await services.getStudent(studentId);
        if (!student) {
          return failure(404, 'not_found');
        }
        if (!managesFamilyOf(caller, student)) {
          return failure(403, 'forbidden');
        }
        await services.revokeFamilyPin(student.id);
        if (student.authUserId) {
          // Switching the account off removes data access at once, even for a session that is
          // still open; the ban stops the session from being renewed. A new slip undoes both.
          await services.setFamilyAccountActive(student.authUserId, false);
          await services.setAuthBanned(student.authUserId, true);
        }
        return ok({ student_id: student.id });
      }
    }
  });
}
