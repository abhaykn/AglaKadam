/**
 * Contracts between the request handlers and the platform. Handlers depend only on these
 * interfaces, so their rules can be tested without a database or the Auth service.
 */

export const STAFF_ROLES = [
  'super_admin',
  'district_officer',
  'block_officer',
  'crp',
  'teacher',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** What the signed-in caller may do, derived from `public.my_access()`. */
export interface CallerAccess {
  userId: string;
  accountKind: 'staff' | 'student';
  mobile: string | null;
  /** Still on an administrator-issued password; such accounts may only change their password. */
  passwordChangeRequired: boolean;
  isSuperAdmin: boolean;
  teacherSchoolIds: string[];
  crpClusterIds: string[];
}

export interface ProfileRecord {
  id: string;
  accountKind: 'staff' | 'student';
  fullName: string;
  mobile: string | null;
  isActive: boolean;
}

export interface AssignmentRecord {
  role: StaffRole;
  schoolId: string | null;
  clusterId: string | null;
  /** Started on or before today; false for a posting scheduled to begin later. */
  isCurrent: boolean;
}

export interface StudentRecord {
  id: string;
  schoolId: string;
  clusterId: string;
  status: 'pending' | 'active' | 'left';
  studentCode: string;
  fullName: string;
  authUserId: string | null;
}

export type CreateUserResult = { id: string } | { error: 'email_in_use' | 'rejected' };

export interface AccountServices {
  findStaffIdByMobile(mobile: string): Promise<string | null>;
  /** Whether the scope exists at the level the role requires (super administrators have none). */
  scopeMatchesRole(role: StaffRole, scopeId: string | null): Promise<boolean>;
  getProfile(userId: string): Promise<ProfileRecord | null>;
  /** Assignments of the user that have not ended, including postings scheduled to begin later. */
  getOpenAssignments(userId: string): Promise<AssignmentRecord[]>;
  clusterOfSchool(schoolId: string): Promise<string | null>;
  createAuthUser(input: {
    email: string;
    password: string;
    appMetadata: Record<string, unknown>;
  }): Promise<CreateUserResult>;
  setAuthPassword(userId: string, password: string): Promise<void>;
  setAuthEmail(userId: string, email: string): Promise<void>;
  setAuthBanned(userId: string, banned: boolean): Promise<void>;
  setPasswordChangeRequired(userId: string, required: boolean): Promise<void>;
  setProfileActive(userId: string, active: boolean): Promise<void>;
  setProfileMobile(userId: string, mobile: string): Promise<void>;
  /** Switches a family account on or off; data access follows immediately. */
  setFamilyAccountActive(userId: string, active: boolean): Promise<void>;
  getStudent(studentId: string): Promise<StudentRecord | null>;
  setFamilyPin(studentId: string, pin: string, issuedBy: string): Promise<void>;
  revokeFamilyPin(studentId: string): Promise<void>;
  /**
   * Whether the account belongs to a demonstration district. Its visitors manage no accounts and
   * keep the passwords they were given, so that every role of the district stays open to them.
   */
  isDemonstration(profileId: string): Promise<boolean>;
}

export interface PasswordServices {
  setAuthPassword(userId: string, password: string): Promise<void>;
  setPasswordChangeRequired(userId: string, required: boolean): Promise<void>;
  /** Ends every session of the user except the one making the request. */
  signOutOtherSessions(): Promise<void>;
  /**
   * Whether the account belongs to a demonstration district. Its visitors manage no accounts and
   * keep the passwords they were given, so that every role of the district stays open to them.
   */
  isDemonstration(profileId: string): Promise<boolean>;
}

export type PinCheck =
  | { status: 'ok'; userId: string }
  | { status: 'invalid' }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'throttled'; retryAfterSeconds: number };

export interface FamilySignInServices {
  /** `clientKey` identifies the client network without revealing its address. */
  verifyPin(learnerCode: string, pin: string, clientKey: string): Promise<PinCheck>;
  /** One-time token for the family account, which the family's device exchanges for a session. */
  createSignInToken(userId: string): Promise<string>;
}

export interface DueRecording {
  path: string;
  /** Past the 30-day listening window, or uploaded but never claimed by a check. */
  reason: 'expired' | 'unclaimed';
}

/** Pulse recordings, or the CRPs' voice notes of their visits. */
export type RetentionKind = 'pulse' | 'notes';

export interface RetentionServices {
  /** Whether `token` is the scheduled job's current token. */
  jobTokenIsValid(token: string): Promise<boolean>;
  dueRecordings(kind: RetentionKind, limit: number): Promise<DueRecording[]>;
  /** Deletes the files through the Storage API. */
  removeFiles(kind: RetentionKind, paths: string[]): Promise<void>;
  /** Notes on the checks or notes that their audio is gone. */
  markRemoved(kind: RetentionKind, paths: string[]): Promise<void>;
}

/** A phone to notify, with what the message reports. */
export interface NotifyRecipient {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  language: 'en' | 'hi';
  message: 'plan_ready' | 'check_back_crp' | 'check_back_teacher' | 'pulse_week';
  firstCount: number;
  secondCount: number;
}

export type NotifyKind = 'plan_ready' | 'daily';

export interface NotifyServices {
  /** Whether `token` is the scheduled job's current token. */
  jobTokenIsValid(token: string): Promise<boolean>;
  recipients(kind: NotifyKind, onDate: string): Promise<NotifyRecipient[]>;
  /** Notes the subscriptions that received a message, and forgets those that are gone. */
  outcome(sent: string[], gone: string[]): Promise<void>;
}

/** A part of the feedback's evidence: a moment noted in the lesson, or a focus item. */
export type EvidenceRef = { moment: string } | { item: string };

/** The feedback a CRP agreed with a teacher, as the database holds it. */
export interface AgreedFeedback {
  visitId: string;
  classSectionId: string;
  teacherId: string | null;
  visitedOn: string;
  lessonNote: string | null;
  strength: string;
  evidence: EvidenceRef[];
  practiceCode: string;
  changeNote: string | null;
  technique: string | null;
  demoGiven: boolean;
  planNote: string | null;
  checkBackOn: string;
  language: 'hi' | 'en';
  agreedAt: string;
  /** The notes of the moments the evidence names. */
  moments: { id: string; tagCode: string; note: string | null }[];
}

export interface FeedbackScore {
  visitId: string;
  specific: number;
  evidence: number;
  oneFocus: number;
  demonstration: number;
  checkBack: number;
  respectful: number;
  total: number;
  tip: string;
  language: 'hi' | 'en';
  model: string;
  feedbackAgreedAt: string;
  /** SHA-256 of the scored feedback's fields (see `feedback-fingerprint.ts`). */
  feedbackFingerprint: string;
  scoredAt: string;
}

export interface RehearsalDebrief {
  id: string;
  scenario: string;
  language: 'hi' | 'en';
  turns: number;
  namedPractice: boolean;
  askedConstraints: boolean;
  agreedCheckBack: boolean;
  keptBlameOut: boolean;
  citedEvidence: boolean;
  wentWell: string;
  tryNext: string;
  provider: 'claude' | 'groq';
  createdAt: string;
}

/** Names to take out of text about a class: its children and its teachers. */
export interface ClassNames {
  children: string[];
  teachers: string[];
}

export interface SahayakServices {
  /** Takes one request from today's allowance of the person (or of the whole project). */
  takeQuota(profileId: string, kind: string, dailyLimit: number): Promise<boolean>;
  /** Gives back a request the service could not answer. */
  returnQuota(profileId: string, kind: string): Promise<void>;
  /** The caller's own visit that took place, with its agreed feedback; read as the caller. */
  agreedFeedback(visitId: string, crpId: string): Promise<AgreedFeedback | null>;
  /** The names of the visit's class and teachers, to be taken out of text before it is sent. */
  namesOfVisit(visitId: string): Promise<ClassNames>;
  /**
   * The names of a class the caller may see: its children and every teacher of it, with the
   * observed teacher named by the visit; null when the class is not one of the caller's. Read as
   * the caller.
   */
  namesOfClass(classSectionId: string, teacherId: string | null): Promise<ClassNames | null>;
  storedScore(visitId: string): Promise<FeedbackScore | null>;
  saveScore(
    score: Omit<FeedbackScore, 'total' | 'scoredAt'>,
    crpId: string,
  ): Promise<FeedbackScore>;
  saveDebrief(
    debrief: Omit<RehearsalDebrief, 'id' | 'createdAt'>,
    crpId: string,
  ): Promise<RehearsalDebrief>;
  /** Whether the account belongs to a demonstration district, whose visitors have smaller allowances. */
  isDemonstration(profileId: string): Promise<boolean>;
}

export const DEMO_ROLES = ['teacher', 'crp', 'officer', 'family'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export type DemoOpening =
  | { status: 'ok'; sandbox: string }
  | { status: 'busy' }
  /** No academic session covers today, and a demonstration never makes one up. */
  | { status: 'unavailable' }
  | { status: 'throttled'; retryAfterSeconds: number };

/** An account the database asks for: a visitor's role, or one of the background staff. */
export interface DemoPerson {
  role: 'teacher' | 'crp' | 'officer' | 'family';
  fullName: string | null;
  /** The school, cluster or block the person is posted to; for a family, null. */
  scope: string | null;
  /** For a family, the child. */
  student: string | null;
  /** For the background staff, their slot. */
  slot: string | null;
}

export interface DemoPlaces {
  postedOn: string;
  accounts: DemoPerson[];
  staff: DemoPerson[];
}

export interface DueDemo {
  sandbox: string;
  files: Record<string, string[]>;
}

export interface DemoServices {
  open(clientKey: string): Promise<DemoOpening>;
  /** Runs one step of building a district; `places` answers with the accounts to create. */
  build(sandbox: string, phase: string, details?: unknown): Promise<Record<string, unknown>>;
  /** Creates a sign-in identity with no password; the database provisions it from the metadata. */
  createAccount(email: string, appMetadata: Record<string, unknown>): Promise<string>;
  /**
   * Records at once an identity made for a district, so that it is deleted with the district even
   * when building stops before the district takes it in.
   */
  noteAccount(sandbox: string, userId: string): Promise<void>;
  /** Deletes an identity; one that is already gone counts as deleted. */
  deleteAccount(userId: string): Promise<void>;
  /** A one-time token that signs the visitor's own device in to the account. */
  signInToken(email: string): Promise<string>;
  accountEmail(sandbox: string, role: DemoRole): Promise<string | null>;
  /** The district of a signed-in demonstration account, or null for any other account. */
  sandboxOf(userId: string): Promise<string | null>;
  storeFile(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  removeFiles(bucket: string, paths: string[]): Promise<void>;
  due(limit: number): Promise<DueDemo[]>;
  /** Notes that removing a district begins; one that keeps failing then waits behind the others. */
  removing(sandbox: string): Promise<void>;
  /** Ends a district now, so that the sweep removes it even if nothing else does. */
  expire(sandbox: string): Promise<void>;
  /** Removes a district's data; its identities are listed to be deleted (see `accountsToDelete`). */
  remove(sandbox: string): Promise<void>;
  /** Identities whose district is gone, still to be deleted through the Auth service. */
  accountsToDelete(limit: number): Promise<string[]>;
  /** Takes a deleted identity off that list. */
  accountDeleted(userId: string): Promise<void>;
  jobTokenIsValid(token: string): Promise<boolean>;
}

/** Reads the caller's access summary. Returns null for an inactive or unprovisioned account. */
export function callerFromAccess(access: unknown): CallerAccess | null {
  if (typeof access !== 'object' || access === null) {
    return null;
  }
  const record = access as Record<string, unknown>;
  if (record['is_active'] !== true || typeof record['user_id'] !== 'string') {
    return null;
  }
  const accountKind = record['account_kind'];
  if (accountKind !== 'staff' && accountKind !== 'student') {
    return null;
  }

  const caller: CallerAccess = {
    userId: record['user_id'],
    accountKind,
    mobile: typeof record['phone'] === 'string' ? record['phone'] : null,
    passwordChangeRequired: record['password_change_required'] === true,
    isSuperAdmin: false,
    teacherSchoolIds: [],
    crpClusterIds: [],
  };

  const assignments = Array.isArray(record['assignments']) ? record['assignments'] : [];
  for (const assignment of assignments) {
    if (typeof assignment !== 'object' || assignment === null) {
      continue;
    }
    const { role, scope } = assignment as {
      role?: unknown;
      scope?: { type?: unknown; id?: unknown } | null;
    };
    const scopeId = typeof scope?.id === 'string' ? scope.id : null;
    if (role === 'super_admin') {
      caller.isSuperAdmin = true;
    } else if (role === 'teacher' && scope?.type === 'school' && scopeId) {
      caller.teacherSchoolIds.push(scopeId);
    } else if (role === 'crp' && scope?.type === 'cluster' && scopeId) {
      caller.crpClusterIds.push(scopeId);
    }
  }
  return caller;
}
