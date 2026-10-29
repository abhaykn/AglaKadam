/**
 * Implementations of the service contracts on top of Supabase, plus the request/response plumbing
 * shared by every function. Rules live in the handlers; this module only talks to the platform.
 */
import { FAMILY_EMAIL_DOMAIN, todayInIndia } from './accounts.ts';
import type { SupabaseClient } from './deps.ts';
import { failure, networkAddressOf, type HandlerResult } from './http.ts';
import {
  type AccountServices,
  type AgreedFeedback,
  type DemoOpening,
  type DemoServices,
  type DueDemo,
  type EvidenceRef,
  type FeedbackScore,
  type RehearsalDebrief,
  type SahayakServices,
  type AssignmentRecord,
  type CallerAccess,
  callerFromAccess,
  type CreateUserResult,
  type FamilySignInServices,
  type NotifyRecipient,
  type NotifyServices,
  type PasswordServices,
  type PinCheck,
  type ProfileRecord,
  type RetentionServices,
  type DueRecording,
  type StaffRole,
  type StudentRecord,
} from './services.ts';

/** Ten years: effectively permanent, and lifted explicitly when an account is reactivated. */
const PERMANENT_BAN = '87600h';

class PlatformError extends Error {
  constructor(operation: string, cause: { message: string; code?: string }) {
    super(`${operation} failed: ${cause.message}${cause.code ? ` (${cause.code})` : ''}`);
    this.name = 'PlatformError';
  }
}

interface ErrorLike {
  message: string;
  code?: string;
}

/** Data of a successful Supabase call; throws for a failed one. */
function unwrap<T>(
  operation: string,
  result: { data: T; error: null } | { data: unknown; error: ErrorLike },
): T {
  if (result.error) {
    throw new PlatformError(operation, result.error);
  }
  return result.data as T;
}

const SCOPE_TABLE: Record<Exclude<StaffRole, 'super_admin'>, string> = {
  district_officer: 'districts',
  block_officer: 'blocks',
  crp: 'clusters',
  teacher: 'schools',
};

/**
 * `admin` bypasses row level security and is used for identity management and system-managed
 * fields. `caller` acts as the signed-in user, so changes an administrator could make directly
 * also go through their own permissions and appear under their name in the audit trail.
 */
/**
 * Whether the account belongs to a demonstration district, also while the district is being built
 * or after it has expired and before the sweep removes it.
 */
async function isDemonstrationAccount(admin: SupabaseClient, profileId: string): Promise<boolean> {
  return (
    unwrap(
      'Reading the account',
      await admin.rpc('service_is_demo_account', { target_user_id: profileId }),
    ) === true
  );
}

export function accountServices(admin: SupabaseClient, caller: SupabaseClient): AccountServices {
  return {
    isDemonstration: (profileId) => isDemonstrationAccount(admin, profileId),
    async findStaffIdByMobile(mobile) {
      const row = unwrap(
        'Looking up a mobile number',
        await admin
          .from('profiles')
          .select('id')
          .eq('account_kind', 'staff')
          .eq('phone', mobile)
          .maybeSingle<{ id: string }>(),
      );
      return row?.id ?? null;
    },

    async scopeMatchesRole(role, scopeId) {
      if (role === 'super_admin') {
        return scopeId === null;
      }
      if (!scopeId) {
        return false;
      }
      let query = admin.from(SCOPE_TABLE[role]).select('id').eq('id', scopeId);
      if (role === 'teacher') {
        query = query.eq('is_active', true);
      }
      const row = unwrap('Checking an assignment scope', await query.maybeSingle());
      return row !== null;
    },

    async getProfile(userId) {
      const row = unwrap(
        'Reading a profile',
        await admin
          .from('profiles')
          .select('id, account_kind, full_name, phone, is_active')
          .eq('id', userId)
          .maybeSingle<{
            id: string;
            account_kind: 'staff' | 'student';
            full_name: string;
            phone: string | null;
            is_active: boolean;
          }>(),
      );
      if (!row) {
        return null;
      }
      const profile: ProfileRecord = {
        id: row.id,
        accountKind: row.account_kind,
        fullName: row.full_name,
        mobile: row.phone,
        isActive: row.is_active,
      };
      return profile;
    },

    async getOpenAssignments(userId) {
      const today = todayInIndia();
      const rows = unwrap(
        'Reading assignments',
        await admin
          .from('staff_assignments')
          .select('role, school_id, cluster_id, starts_on')
          .eq('user_id', userId)
          .or(`ends_on.is.null,ends_on.gte.${today}`)
          .returns<
            {
              role: StaffRole;
              school_id: string | null;
              cluster_id: string | null;
              starts_on: string;
            }[]
          >(),
      );
      return rows.map((row): AssignmentRecord => ({
        role: row.role,
        schoolId: row.school_id,
        clusterId: row.cluster_id,
        isCurrent: row.starts_on <= today,
      }));
    },

    async clusterOfSchool(schoolId) {
      const row = unwrap(
        'Reading a school',
        await admin
          .from('schools')
          .select('cluster_id')
          .eq('id', schoolId)
          .maybeSingle<{ cluster_id: string }>(),
      );
      return row?.cluster_id ?? null;
    },

    async createAuthUser({ email, password, appMetadata }): Promise<CreateUserResult> {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
      });
      if (error) {
        if (error.code === 'email_exists' || error.code === 'user_already_exists') {
          return { error: 'email_in_use' };
        }
        // The provisioning trigger refusing the account surfaces as a database error.
        console.error(
          `Creating a sign-in identity failed: ${error.message} (${error.code ?? 'no code'})`,
        );
        return { error: 'rejected' };
      }
      return { id: data.user.id };
    },

    async setAuthPassword(userId, password) {
      unwrap('Setting a password', await admin.auth.admin.updateUserById(userId, { password }));
    },

    async setAuthEmail(userId, email) {
      unwrap(
        'Changing a sign-in identity',
        await admin.auth.admin.updateUserById(userId, { email, email_confirm: true }),
      );
    },

    async setAuthBanned(userId, banned) {
      unwrap(
        'Changing sign-in access',
        await admin.auth.admin.updateUserById(userId, {
          ban_duration: banned ? PERMANENT_BAN : 'none',
        }),
      );
    },

    async setPasswordChangeRequired(userId, required) {
      unwrap(
        'Updating the password requirement',
        await admin
          .from('profiles')
          .update({ password_change_required: required })
          .eq('id', userId),
      );
    },

    async setProfileActive(userId, active) {
      unwrap(
        'Changing account status',
        await caller.from('profiles').update({ is_active: active }).eq('id', userId),
      );
    },

    async setProfileMobile(userId, mobile) {
      unwrap(
        'Changing a mobile number',
        await caller.from('profiles').update({ phone: mobile }).eq('id', userId),
      );
    },

    async setFamilyAccountActive(userId, active) {
      unwrap(
        'Changing a family account',
        await admin
          .from('profiles')
          .update({ is_active: active })
          .eq('id', userId)
          .eq('account_kind', 'student'),
      );
    },

    async getStudent(studentId) {
      const row = unwrap(
        'Reading a student',
        await admin
          .from('students')
          .select(
            'id, school_id, status, student_code, full_name, auth_user_id, schools(cluster_id)',
          )
          .eq('id', studentId)
          .maybeSingle<{
            id: string;
            school_id: string;
            status: 'pending' | 'active' | 'left';
            student_code: string;
            full_name: string;
            auth_user_id: string | null;
            schools: { cluster_id: string } | null;
          }>(),
      );
      if (!row?.schools) {
        return null;
      }
      const student: StudentRecord = {
        id: row.id,
        schoolId: row.school_id,
        clusterId: row.schools.cluster_id,
        status: row.status,
        studentCode: row.student_code,
        fullName: row.full_name,
        authUserId: row.auth_user_id,
      };
      return student;
    },

    async setFamilyPin(studentId, pin, issuedBy) {
      unwrap(
        'Storing a family PIN',
        await admin.rpc('service_set_family_pin', {
          target_student_id: studentId,
          pin,
          issued_by: issuedBy,
        }),
      );
    },

    async revokeFamilyPin(studentId) {
      unwrap(
        'Revoking a family PIN',
        await admin.rpc('service_revoke_family_pin', { target_student_id: studentId }),
      );
    },
  };
}

export function passwordServices(
  admin: SupabaseClient,
  userId: string,
  jwt: string,
): PasswordServices {
  return {
    isDemonstration: (profileId) => isDemonstrationAccount(admin, profileId),
    async setAuthPassword(targetUserId, password) {
      unwrap(
        'Setting a password',
        await admin.auth.admin.updateUserById(targetUserId, { password }),
      );
    },
    async setPasswordChangeRequired(targetUserId, required) {
      unwrap(
        'Updating the password requirement',
        await admin
          .from('profiles')
          .update({ password_change_required: required })
          .eq('id', targetUserId),
      );
    },
    async signOutOtherSessions() {
      const { error } = await admin.auth.admin.signOut(jwt, 'others');
      if (error) {
        // The password has already changed; failing to end other sessions must not undo that.
        console.error(`Ending other sessions of ${userId} failed: ${error.message}`);
      }
    },
  };
}

export function familySignInServices(admin: SupabaseClient): FamilySignInServices {
  return {
    async verifyPin(learnerCode, pin, clientKey): Promise<PinCheck> {
      const result = unwrap(
        'Checking a family PIN',
        await admin.rpc('service_verify_family_pin', {
          learner_code: learnerCode,
          pin,
          client_key: clientKey,
        }),
      ) as { status?: string; user_id?: string; retry_after_seconds?: number } | null;
      if (result?.status === 'ok' && typeof result.user_id === 'string') {
        return { status: 'ok', userId: result.user_id };
      }
      if (result?.status === 'locked' || result?.status === 'throttled') {
        return { status: result.status, retryAfterSeconds: result.retry_after_seconds ?? 900 };
      }
      return { status: 'invalid' };
    },

    async createSignInToken(userId) {
      const { user } = unwrap(
        'Reading a family account',
        await admin.auth.admin.getUserById(userId),
      );
      if (!user.email?.endsWith(`@${FAMILY_EMAIL_DOMAIN}`)) {
        throw new Error('The account matched by the PIN is not a family account.');
      }
      const data = unwrap(
        'Creating a sign-in token',
        await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email }),
      );
      return data.properties.hashed_token;
    },
  };
}

interface ScoreRow {
  visit_id: string;
  specific: number;
  evidence: number;
  one_focus: number;
  demonstration: number;
  check_back: number;
  respectful: number;
  total: number;
  tip: string;
  language: 'hi' | 'en';
  model: string;
  feedback_agreed_at: string;
  feedback_fingerprint: string;
  scored_at: string;
}

const SCORE_COLUMNS =
  'visit_id, specific, evidence, one_focus, demonstration, check_back, respectful, total, tip, language, model, feedback_agreed_at, feedback_fingerprint, scored_at';

function toScore(row: ScoreRow): FeedbackScore {
  return {
    visitId: row.visit_id,
    specific: row.specific,
    evidence: row.evidence,
    oneFocus: row.one_focus,
    demonstration: row.demonstration,
    checkBack: row.check_back,
    respectful: row.respectful,
    total: row.total,
    tip: row.tip,
    language: row.language,
    model: row.model,
    // The database writes times in its own format; they are compared in this one.
    feedbackAgreedAt: new Date(row.feedback_agreed_at).toISOString(),
    feedbackFingerprint: row.feedback_fingerprint,
    scoredAt: row.scored_at,
  };
}

function evidenceOf(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): EvidenceRef[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.moment === 'string') {
      return [{ moment: record.moment }];
    }
    return typeof record.item === 'string' ? [{ item: record.item }] : [];
  });
}

interface VisitWithFeedback {
  id: string;
  class_section_id: string;
  teacher_id: string | null;
  visited_on: string;
  lesson_note: string | null;
  visit_feedback: {
    strength: string;
    evidence: unknown;
    practice_code: string;
    change_note: string | null;
    technique: string | null;
    demo_given: boolean;
    plan_note: string | null;
    check_back_on: string;
    language: 'hi' | 'en';
    agreed_at: string | null;
  } | null;
}

/**
 * Sahayak's records. Visits and names are read as the caller, so row-level security decides what
 * a CRP may have scored; the allowance, scores and debriefs are written with the secret key.
 */
export function sahayakServices(admin: SupabaseClient, caller: SupabaseClient): SahayakServices {
  return {
    async takeQuota(profileId, kind, dailyLimit) {
      const taken = unwrap(
        'Taking the allowance',
        await admin.rpc('service_take_ai_quota', {
          target_profile_id: profileId,
          usage_kind: kind,
          daily_limit: dailyLimit,
        }),
      );
      return taken === true;
    },
    async returnQuota(profileId, kind) {
      unwrap(
        'Returning the allowance',
        await admin.rpc('service_return_ai_quota', {
          target_profile_id: profileId,
          usage_kind: kind,
        }),
      );
    },
    async agreedFeedback(visitId, crpId): Promise<AgreedFeedback | null> {
      const visit = unwrap(
        'Reading the visit',
        await caller
          .from('visits')
          .select(
            'id, class_section_id, teacher_id, visited_on, lesson_note, visit_feedback(strength, evidence, practice_code, change_note, technique, demo_given, plan_note, check_back_on, language, agreed_at)',
          )
          .eq('id', visitId)
          .eq('crp_id', crpId)
          .eq('status', 'done')
          .maybeSingle(),
      ) as VisitWithFeedback | null;
      const feedback = visit?.visit_feedback;
      if (!visit || !feedback?.agreed_at) {
        return null;
      }
      const moments = unwrap(
        'Reading the moments',
        await caller.from('visit_moments').select('id, tag_code, note').eq('visit_id', visitId),
      ) as { id: string; tag_code: string; note: string | null }[];
      return {
        visitId: visit.id,
        classSectionId: visit.class_section_id,
        teacherId: visit.teacher_id,
        visitedOn: visit.visited_on,
        lessonNote: visit.lesson_note,
        strength: feedback.strength,
        evidence: evidenceOf(feedback.evidence),
        practiceCode: feedback.practice_code,
        changeNote: feedback.change_note,
        technique: feedback.technique,
        demoGiven: feedback.demo_given,
        planNote: feedback.plan_note,
        checkBackOn: feedback.check_back_on,
        language: feedback.language,
        agreedAt: new Date(feedback.agreed_at).toISOString(),
        moments: moments.map((moment) => ({
          id: moment.id,
          tagCode: moment.tag_code,
          note: moment.note,
        })),
      };
    },
    async namesOfVisit(visitId) {
      const visit = unwrap(
        'Reading the visit',
        await caller
          .from('visits')
          .select('class_section_id, teacher_id')
          .eq('id', visitId)
          .maybeSingle(),
      ) as { class_section_id: string; teacher_id: string | null } | null;
      if (!visit) {
        return { children: [], teachers: [] };
      }
      return {
        children: await childrenOfClass(caller, visit.class_section_id),
        teachers: await teachersOfClass(caller, visit.class_section_id, visit.teacher_id),
      };
    },
    async namesOfClass(classSectionId, teacherId) {
      const section = unwrap(
        'Reading the class',
        await caller.from('class_sections').select('id').eq('id', classSectionId).maybeSingle(),
      ) as { id: string } | null;
      if (!section) {
        return null;
      }
      return {
        children: await childrenOfClass(caller, classSectionId),
        teachers: await teachersOfClass(caller, classSectionId, teacherId),
      };
    },
    async storedScore(visitId) {
      const row = unwrap(
        'Reading the score',
        await admin
          .from('visit_feedback_scores')
          .select(SCORE_COLUMNS)
          .eq('visit_id', visitId)
          .maybeSingle(),
      ) as ScoreRow | null;
      return row ? toScore(row) : null;
    },
    async saveScore(score, crpId) {
      const row = unwrap(
        'Saving the score',
        await admin
          .from('visit_feedback_scores')
          .upsert(
            {
              visit_id: score.visitId,
              crp_id: crpId,
              specific: score.specific,
              evidence: score.evidence,
              one_focus: score.oneFocus,
              demonstration: score.demonstration,
              check_back: score.checkBack,
              respectful: score.respectful,
              tip: score.tip,
              language: score.language,
              model: score.model,
              feedback_agreed_at: score.feedbackAgreedAt,
              feedback_fingerprint: score.feedbackFingerprint,
              scored_at: new Date().toISOString(),
            },
            { onConflict: 'visit_id' },
          )
          .select(SCORE_COLUMNS)
          .single(),
      ) as ScoreRow;
      return toScore(row);
    },
    async saveDebrief(debrief, crpId): Promise<RehearsalDebrief> {
      const row = unwrap(
        'Saving the debrief',
        await admin
          .from('rehearsal_debriefs')
          .insert({
            crp_id: crpId,
            scenario: debrief.scenario,
            language: debrief.language,
            turns: debrief.turns,
            named_practice: debrief.namedPractice,
            asked_constraints: debrief.askedConstraints,
            agreed_check_back: debrief.agreedCheckBack,
            kept_blame_out: debrief.keptBlameOut,
            cited_evidence: debrief.citedEvidence,
            went_well: debrief.wentWell,
            try_next: debrief.tryNext,
            provider: debrief.provider,
          })
          .select('id, created_at')
          .single(),
      ) as { id: string; created_at: string };
      return { ...debrief, id: row.id, createdAt: row.created_at };
    },
    isDemonstration: (profileId) => isDemonstrationAccount(admin, profileId),
  };
}

/** Everyone ever enrolled in a class: a child who has left may still be named in a note. */
async function childrenOfClass(caller: SupabaseClient, classSectionId: string): Promise<string[]> {
  const roll = unwrap(
    'Reading the class',
    await caller
      .from('enrolments')
      .select('students!inner(full_name)')
      .eq('class_section_id', classSectionId),
  ) as unknown as { students: { full_name: string } | { full_name: string }[] }[];
  return roll.flatMap((row) =>
    Array.isArray(row.students)
      ? row.students.map((student) => student.full_name)
      : [row.students.full_name],
  );
}

/**
 * Every teacher of a class, as the school's records hold them, and the teacher a visit observed:
 * the phone's word for who teaches there is not relied on.
 */
async function teachersOfClass(
  caller: SupabaseClient,
  classSectionId: string,
  observedId: string | null,
): Promise<string[]> {
  const rows = unwrap(
    'Reading the teachers of the class',
    await caller.from('class_teachers').select('teacher_id').eq('class_section_id', classSectionId),
  ) as { teacher_id: string }[];
  const ids = [
    ...new Set([...rows.map((row) => row.teacher_id), ...(observedId ? [observedId] : [])]),
  ];
  if (ids.length === 0) {
    return [];
  }
  const profiles = unwrap(
    'Reading the teachers',
    await caller.from('profiles').select('full_name').in('id', ids),
  ) as { full_name: string }[];
  return profiles.map((profile) => profile.full_name);
}

function textOr(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' ? value : fallback;
}

/** Demonstration districts: built and removed through the database, accounts through Auth. */
export function demoServices(admin: SupabaseClient): DemoServices {
  return {
    async open(clientKey): Promise<DemoOpening> {
      const result = unwrap(
        'Opening a demonstration district',
        await admin.rpc('service_demo_open', { client_key: clientKey }),
      ) as { status?: string; sandbox?: string; retry_after_seconds?: number } | null;
      if (result?.status === 'ok' && typeof result.sandbox === 'string') {
        return { status: 'ok', sandbox: result.sandbox };
      }
      if (result?.status === 'throttled') {
        return { status: 'throttled', retryAfterSeconds: result.retry_after_seconds ?? 3600 };
      }
      if (result?.status === 'unavailable') {
        return { status: 'unavailable' };
      }
      return { status: 'busy' };
    },

    async build(sandbox, phase, details = {}) {
      const result = unwrap(
        `Building the district (${phase})`,
        await admin.rpc('service_demo_build', {
          target_sandbox: sandbox,
          phase,
          details: details as never,
        }),
      );
      return typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : {};
    },

    async createAccount(email, appMetadata) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: appMetadata,
      });
      if (error) {
        throw new PlatformError('Creating a demonstration account', error);
      }
      return data.user.id;
    },

    async deleteAccount(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      // An account already gone is what was wanted.
      if (error && error.status !== 404) {
        throw new PlatformError('Removing a demonstration account', error);
      }
    },

    async signInToken(email) {
      const data = unwrap(
        'Creating a sign-in token',
        await admin.auth.admin.generateLink({ type: 'magiclink', email }),
      );
      return data.properties.hashed_token;
    },

    async accountEmail(sandbox, role) {
      const email = unwrap(
        'Reading a demonstration account',
        await admin.rpc('service_demo_account', { target_sandbox: sandbox, role }),
      );
      return textOr(email);
    },

    async sandboxOf(userId) {
      const sandbox = unwrap(
        'Reading the account',
        await admin.rpc('service_demo_sandbox_of', { target_user_id: userId }),
      );
      return textOr(sandbox);
    },

    async storeFile(bucket, path, bytes, contentType) {
      unwrap(
        'Storing a file',
        await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: true }),
      );
    },

    async removeFiles(bucket, paths) {
      for (let start = 0; start < paths.length; start += 100) {
        unwrap(
          'Removing files',
          await admin.storage.from(bucket).remove(paths.slice(start, start + 100)),
        );
      }
    },

    async due(limit) {
      const rows = unwrap(
        'Listing expired demonstration districts',
        await admin.rpc('service_demo_due', { batch_size: limit }),
      ) as { sandbox?: unknown; files?: unknown }[] | null;
      return (rows ?? []).flatMap((row): DueDemo[] => {
        if (typeof row.sandbox !== 'string') {
          return [];
        }
        const files: Record<string, string[]> = {};
        if (typeof row.files === 'object' && row.files !== null) {
          for (const [bucket, names] of Object.entries(row.files as Record<string, unknown>)) {
            files[bucket] = Array.isArray(names)
              ? names.filter((name): name is string => typeof name === 'string')
              : [];
          }
        }
        return [{ sandbox: row.sandbox, files }];
      });
    },

    async remove(sandbox) {
      unwrap(
        'Removing a demonstration district',
        await admin.rpc('service_demo_remove', { target_sandbox: sandbox }),
      );
    },

    async removing(sandbox) {
      unwrap(
        'Starting to remove a demonstration district',
        await admin.rpc('service_demo_removing', { target_sandbox: sandbox }),
      );
    },

    async expire(sandbox) {
      unwrap(
        'Ending a demonstration district',
        await admin.rpc('service_demo_expire', { target_sandbox: sandbox }),
      );
    },

    async noteAccount(sandbox, userId) {
      unwrap(
        'Recording a demonstration account',
        await admin.rpc('service_demo_note_account', {
          target_sandbox: sandbox,
          target_user_id: userId,
        }),
      );
    },

    async accountsToDelete(limit) {
      const ids = unwrap(
        'Listing demonstration accounts to delete',
        await admin.rpc('service_demo_accounts_to_delete', { batch_size: limit }),
      ) as unknown;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    },

    async accountDeleted(userId) {
      unwrap(
        'Recording a deleted demonstration account',
        await admin.rpc('service_demo_account_deleted', { target_user_id: userId }),
      );
    },

    async jobTokenIsValid(token) {
      return (
        unwrap(
          'Checking the job token',
          await admin.rpc('service_job_token_valid', { job: 'demo', token }),
        ) === true
      );
    },
  };
}

/** The account a request's bearer token belongs to, checked by the Auth service; null without one. */
export async function userOfToken(admin: SupabaseClient, token: string): Promise<string | null> {
  if (token === '') {
    return null;
  }
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user.id;
}

/** The signed-in caller's access, or null when the account is inactive or unprovisioned. */
export async function loadCaller(caller: SupabaseClient): Promise<CallerAccess | null> {
  const access = unwrap('Reading access', await caller.rpc('my_access'));
  return callerFromAccess(access);
}

const NOTIFY_MESSAGES = new Set<NotifyRecipient['message']>([
  'plan_ready',
  'check_back_crp',
  'check_back_teacher',
  'pulse_week',
]);

export function notifyServices(admin: SupabaseClient): NotifyServices {
  return {
    async jobTokenIsValid(token) {
      return (
        unwrap(
          'Checking the job token',
          await admin.rpc('service_job_token_valid', { job: 'notify', token }),
        ) === true
      );
    },

    async recipients(kind, onDate) {
      const rows = unwrap(
        'Listing whom to notify',
        await admin.rpc('service_push_recipients', { kind, on_date: onDate }),
      ) as
        | {
            endpoint: string;
            p256dh: string;
            auth_secret: string;
            language: string;
            message: string;
            first_count: number;
            second_count: number;
          }[]
        | null;
      return (rows ?? []).flatMap((row): NotifyRecipient[] => {
        const message = row.message as NotifyRecipient['message'];
        if (!NOTIFY_MESSAGES.has(message)) {
          return [];
        }
        return [
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth_secret },
            language: row.language === 'en' ? 'en' : 'hi',
            message,
            firstCount: row.first_count,
            secondCount: row.second_count,
          },
        ];
      });
    },

    async outcome(sent, gone) {
      unwrap(
        'Recording the notifications',
        await admin.rpc('service_push_outcome', { sent, gone }),
      );
    },
  };
}

/** Where each kind of recording is stored, and the database functions that list and mark it. */
const RETAINED = {
  pulse: {
    bucket: 'pulse-audio',
    due: 'service_pulse_audio_to_remove',
    mark: 'service_mark_pulse_audio_removed',
  },
  notes: {
    bucket: 'visit-notes',
    due: 'service_visit_notes_to_remove',
    mark: 'service_mark_visit_notes_removed',
  },
} as const;

export function retentionServices(admin: SupabaseClient): RetentionServices {
  return {
    async jobTokenIsValid(token) {
      return (
        unwrap(
          'Checking the job token',
          await admin.rpc('service_job_token_valid', { job: 'pulse_retention', token }),
        ) === true
      );
    },

    async dueRecordings(kind, limit) {
      const rows = unwrap(
        'Listing recordings to remove',
        await admin.rpc(RETAINED[kind].due, { batch_size: limit }),
      ) as { path: string; reason: string }[] | null;
      return (rows ?? []).map((row): DueRecording => ({
        path: row.path,
        reason: row.reason === 'expired' ? 'expired' : 'unclaimed',
      }));
    },

    async removeFiles(kind, paths) {
      unwrap('Removing recordings', await admin.storage.from(RETAINED[kind].bucket).remove(paths));
    },

    async markRemoved(kind, paths) {
      unwrap('Recording the removal', await admin.rpc(RETAINED[kind].mark, { paths }));
    },
  };
}

/**
 * Opaque key for the network a request comes from (see `networkAddressOf`), so that no address is
 * ever stored. The hash is keyed with the project's secret: a plain hash of an address could be
 * reversed by hashing every possible address.
 */
export async function clientKeyFor(req: Request): Promise<string> {
  const address = networkAddressOf(req.headers);
  if (address === '') {
    return 'unknown';
  }
  const secret =
    Deno.env.get('SUPABASE_SECRET_KEYS')?.trim() ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ||
    '';
  const encoder = new TextEncoder();
  const digest =
    secret === ''
      ? await crypto.subtle.digest('SHA-256', encoder.encode(address))
      : await crypto.subtle.sign(
          'HMAC',
          await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          ),
          encoder.encode(address),
        );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Bearer token of the request, used where the Auth service needs the caller's own session. */
export function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Runs a request through a handler and converts the result into an HTTP response. Unexpected
 * failures are logged with the function name and answered with a generic error, so that internal
 * details never reach the client.
 */
export async function serve(
  functionName: string,
  req: Request,
  work: () => Promise<HandlerResult>,
): Promise<Response> {
  if (req.method !== 'POST') {
    const result = failure(405, 'method_not_allowed');
    return Response.json(result.body, {
      status: result.status,
      headers: { Allow: 'POST, OPTIONS' },
    });
  }
  try {
    const result = await work();
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error(`${functionName}: ${error instanceof Error ? error.message : String(error)}`);
    const result = failure(500, 'internal_error');
    return Response.json(result.body, { status: result.status });
  }
}
