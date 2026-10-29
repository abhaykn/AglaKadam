import type { PostgrestError } from '@supabase/supabase-js';
import { todayInIndia } from '@shared/accounts.ts';
import type { Json } from '@/lib/database';
import { callFunction, FunctionCallError } from '@/lib/functions';
import { getSupabase } from '@/lib/supabase';
import type { StaffRole } from '@/features/auth/access';

export const PAGE_SIZE = 50;

export interface ImportProblem {
  row: number;
  field: string;
  issue: 'required' | 'format' | 'duplicate' | 'conflict' | 'unknown' | 'ambiguous';
}

/** An import the database refused, with the problems it found in the file. */
export class ImportRejectedError extends Error {
  constructor(readonly problems: ImportProblem[]) {
    super('The import was rejected.');
    this.name = 'ImportRejectedError';
  }
}

function parseProblems(details: string): ImportProblem[] | null {
  try {
    return JSON.parse(details) as ImportProblem[];
  } catch {
    return null;
  }
}

function rethrowImportError(error: PostgrestError): never {
  const problems = error.hint === 'import_problems' ? parseProblems(error.details) : null;
  if (problems) {
    throw new ImportRejectedError(problems);
  }
  throw error;
}

/**
 * A search as a PostgREST pattern. Characters that would change the meaning of the filter, and
 * punctuation that people type inconsistently (as in "G.P.S." or "R.K. Sharma"), match any text, so
 * a name is found whether or not the punctuation is typed exactly.
 */
export function searchTerm(input: string): string {
  return input
    .replace(/[%_,()*\\:."']/g, '*')
    .replace(/\s+/g, ' ')
    .replace(/\s*\*[\s*]*/g, '*')
    .replace(/^\*+|\*+$/g, '')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

export interface AdminOverview {
  schools: number;
  clusters: number;
  blocks: number;
  districts: number;
  staff: Partial<Record<StaffRole, number>>;
  students: Partial<Record<'pending' | 'active' | 'left', number>>;
  family_accounts: number;
  current_academic_year: { id: string; label: string; starts_on: string; ends_on: string } | null;
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await getSupabase().rpc('admin_overview');
  if (error) {
    throw error;
  }
  return data as unknown as AdminOverview;
}

// ---------------------------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------------------------

export async function fetchSchools(search: string, page: number) {
  let query = getSupabase()
    .from('schools')
    .select(
      'id, udise_code, name_en, name_hi, village, is_active, clusters!inner(code, name_en, name_hi, blocks!inner(name_en, name_hi, districts!inner(name_en, name_hi)))',
      { count: 'exact' },
    )
    .order('name_en')
    .order('id')
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  const term = searchTerm(search);
  if (term) {
    query = query.or(`name_en.ilike.*${term}*,name_hi.ilike.*${term}*,udise_code.ilike.*${term}*`);
  }
  const { data, error, count } = await query;
  if (error) {
    throw error;
  }
  return { rows: data, total: count ?? 0 };
}

export async function updateSchool(
  id: string,
  changes: { name_en: string; name_hi: string | null; village: string | null; is_active: boolean },
): Promise<void> {
  const { error } = await getSupabase().from('schools').update(changes).eq('id', id);
  if (error) {
    throw error;
  }
}

export interface ImportSummary {
  created: number;
  updated: number;
}

export interface SchoolImportResult {
  rows: number;
  states: ImportSummary;
  districts: ImportSummary;
  blocks: ImportSummary;
  clusters: ImportSummary;
  schools: ImportSummary;
}

export async function importSchools(rows: Record<string, string>[]): Promise<SchoolImportResult> {
  const { data, error } = await getSupabase().rpc('import_schools', { rows: rows as Json });
  if (error) {
    rethrowImportError(error);
  }
  return data as unknown as SchoolImportResult;
}

// ---------------------------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------------------------

export async function fetchStaff(search: string, role: StaffRole | 'all', page: number) {
  const profiles = getSupabase().from('profiles');
  // Filtering by role needs an inner join, so that people without that role are left out.
  let query = (
    role === 'all'
      ? profiles.select(
          'id, full_name, phone, is_active, password_change_required, staff_assignments!staff_assignments_user_id_fkey(id, role, starts_on, ends_on, schools(name_en, name_hi, udise_code), clusters(name_en, name_hi, code), blocks(name_en, name_hi), districts(name_en, name_hi))',
          { count: 'exact' },
        )
      : profiles.select(
          'id, full_name, phone, is_active, password_change_required, staff_assignments!staff_assignments_user_id_fkey!inner(id, role, starts_on, ends_on, schools(name_en, name_hi, udise_code), clusters(name_en, name_hi, code), blocks(name_en, name_hi), districts(name_en, name_hi))',
          { count: 'exact' },
        )
  )
    .eq('account_kind', 'staff')
    // Postings that have not ended, including the current one when a transfer is scheduled.
    .or(`ends_on.is.null,ends_on.gte.${todayInIndia()}`, { referencedTable: 'staff_assignments' })
    .order('full_name')
    .order('id')
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (role !== 'all') {
    query = query.eq('staff_assignments.role', role);
  }
  const term = searchTerm(search);
  if (term) {
    query = query.or(`full_name.ilike.*${term}*,phone.ilike.*${term}*`);
  }
  const { data, error, count } = await query;
  if (error) {
    throw error;
  }
  return { rows: data, total: count ?? 0 };
}

export interface StaffDraft {
  full_name: string;
  mobile: string;
  role: StaffRole;
  scope_id: string | null;
  preferred_language: 'en' | 'hi';
  starts_on?: string;
}

export type StaffCreationOutcome =
  | {
      index: number;
      status: 'created';
      user_id: string;
      full_name: string;
      mobile: string;
      temporary_password: string;
    }
  | {
      index: number;
      status: 'failed';
      /** `unconfirmed`: the request was interrupted, so the account may or may not exist. */
      error: 'mobile_in_use' | 'invalid_scope' | 'rejected' | 'unconfirmed';
    };

/**
 * Creates accounts in requests of up to one hundred, the most the service accepts. When a request
 * fails part-way, the accounts already created are returned with their temporary passwords, which
 * are shown only once, and the rows whose outcome is not known are reported as unconfirmed instead
 * of the whole import failing.
 */
export async function createStaff(accounts: StaffDraft[]): Promise<StaffCreationOutcome[]> {
  const outcomes: StaffCreationOutcome[] = [];
  for (let start = 0; start < accounts.length; start += 100) {
    const batch = accounts.slice(start, start + 100);
    let result: { results: StaffCreationOutcome[] };
    try {
      result = await callFunction<{ results: StaffCreationOutcome[] }>('account-admin', {
        action: 'create_staff',
        accounts: batch,
      });
    } catch (error) {
      // A refusal (4xx) happens before any account is created, so the first request failing that
      // way means nothing was saved. A lost connection or a server error may have stopped part-way.
      const refusedBeforeCreating =
        error instanceof FunctionCallError && error.status >= 400 && error.status < 500;
      if (start === 0 && refusedBeforeCreating) {
        throw error;
      }
      for (let index = start; index < accounts.length; index += 1) {
        outcomes.push({ index, status: 'failed', error: 'unconfirmed' });
      }
      return outcomes;
    }
    outcomes.push(
      ...result.results.map((outcome) => ({ ...outcome, index: outcome.index + start })),
    );
  }
  return outcomes;
}

export function resetStaffPassword(userId: string) {
  return callFunction<{ user_id: string; temporary_password: string }>('account-admin', {
    action: 'reset_staff_password',
    user_id: userId,
  });
}

export function setStaffActive(userId: string, active: boolean) {
  return callFunction<{ user_id: string; active: boolean }>('account-admin', {
    action: 'set_staff_active',
    user_id: userId,
    active,
  });
}

export function changeStaffMobile(userId: string, mobile: string) {
  return callFunction<{ user_id: string; mobile: string }>('account-admin', {
    action: 'change_staff_mobile',
    user_id: userId,
    mobile,
  });
}

export async function transferAssignment(input: {
  assignmentId: string;
  role: StaffRole;
  scopeId: string | null;
  effectiveOn: string;
}): Promise<void> {
  const { error } = await getSupabase().rpc('transfer_assignment', {
    assignment_id: input.assignmentId,
    new_role: input.role,
    effective_on: input.effectiveOn,
    ...(input.scopeId ? { new_scope_id: input.scopeId } : {}),
  });
  if (error) {
    throw error;
  }
}

export interface ScopeOption {
  id: string;
  code: string;
  name: string;
  context: string;
  /** Set for schools; false when the school has been switched off. */
  isActive?: boolean;
}

/**
 * Districts, blocks, clusters or schools matching a search, for choosing an assignment scope.
 * Schools that are switched off are left out unless `includeInactiveSchools` is set, because staff
 * cannot be posted to them but their records can still be looked after.
 */
export async function searchScopes(
  role: StaffRole,
  search: string,
  { includeInactiveSchools = false }: { includeInactiveSchools?: boolean } = {},
): Promise<ScopeOption[]> {
  const supabase = getSupabase();
  const term = searchTerm(search);
  const nameFilter = (codeColumn: string) =>
    term ? `name_en.ilike.*${term}*,name_hi.ilike.*${term}*,${codeColumn}.ilike.*${term}*` : null;

  switch (role) {
    case 'super_admin':
      return [];
    case 'teacher': {
      let query = supabase
        .from('schools')
        .select('id, udise_code, name_en, is_active, clusters(name_en)')
        .order('name_en')
        .order('id')
        .limit(20);
      if (!includeInactiveSchools) {
        query = query.eq('is_active', true);
      }
      const filter = nameFilter('udise_code');
      if (filter) {
        query = query.or(filter);
      }
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        code: row.udise_code,
        name: row.name_en,
        context: row.clusters.name_en,
        isActive: row.is_active,
      }));
    }
    case 'crp': {
      let query = supabase
        .from('clusters')
        .select('id, code, name_en, blocks(name_en)')
        .order('name_en')
        .limit(20);
      const filter = nameFilter('code');
      if (filter) {
        query = query.or(filter);
      }
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name_en,
        context: row.blocks.name_en,
      }));
    }
    case 'block_officer': {
      let query = supabase
        .from('blocks')
        .select('id, code, name_en, districts(name_en)')
        .order('name_en')
        .limit(20);
      const filter = nameFilter('code');
      if (filter) {
        query = query.or(filter);
      }
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name_en,
        context: row.districts.name_en,
      }));
    }
    case 'district_officer': {
      let query = supabase
        .from('districts')
        .select('id, code, name_en, states(name_en)')
        .order('name_en')
        .limit(20);
      const filter = nameFilter('code');
      if (filter) {
        query = query.or(filter);
      }
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return data.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name_en,
        context: row.states.name_en,
      }));
    }
  }
}

/** Rows read per request when resolving scope codes; below the Data API's limit of 1000. */
const SCOPE_LOOKUP_PAGE = 500;

/**
 * Identifiers for the scope codes used in a staff import. A code that matches more than one record
 * (cluster, block and district codes are unique only within their parent) is reported as ambiguous.
 */
export async function resolveScopeCodes(
  requests: { role: StaffRole; code: string }[],
): Promise<Map<string, { id: string } | 'unknown' | 'ambiguous'>> {
  const supabase = getSupabase();
  const byRole = new Map<StaffRole, Set<string>>();
  for (const { role, code } of requests) {
    if (role === 'super_admin') {
      continue;
    }
    const codes = byRole.get(role) ?? new Set<string>();
    codes.add(code);
    byRole.set(role, codes);
  }

  const resolved = new Map<string, { id: string } | 'unknown' | 'ambiguous'>();
  for (const [role, codes] of byRole) {
    const list = [...codes];
    const lookups: { id: string; code: string }[] = [];
    for (let start = 0; start < list.length; start += 200) {
      const chunk = list.slice(start, start + 200);
      // The Data API returns at most 1000 rows per request; codes that repeat across blocks or
      // districts can match more, so every page is read before deciding what is ambiguous.
      for (let offset = 0; ; offset += SCOPE_LOOKUP_PAGE) {
        const response =
          role === 'teacher'
            ? await supabase
                .from('schools')
                .select('id, code:udise_code')
                .in('udise_code', chunk)
                .order('id')
                .range(offset, offset + SCOPE_LOOKUP_PAGE - 1)
            : await supabase
                .from(
                  role === 'crp' ? 'clusters' : role === 'block_officer' ? 'blocks' : 'districts',
                )
                .select('id, code')
                .in('code', chunk)
                .order('id')
                .range(offset, offset + SCOPE_LOOKUP_PAGE - 1);
        if (response.error) {
          throw response.error;
        }
        const rows = response.data as { id: string; code: string }[];
        lookups.push(...rows);
        if (rows.length < SCOPE_LOOKUP_PAGE) {
          break;
        }
      }
    }
    for (const code of list) {
      const matches = lookups.filter((row) => row.code === code);
      const key = `${role}:${code}`;
      const [only] = matches;
      resolved.set(
        key,
        matches.length === 0 || !only
          ? 'unknown'
          : matches.length > 1
            ? 'ambiguous'
            : { id: only.id },
      );
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------------------------

export async function fetchAcademicYears() {
  const { data, error } = await getSupabase()
    .from('academic_years')
    .select('id, label, starts_on, ends_on')
    .order('starts_on', { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}

export async function createAcademicYear(input: {
  label: string;
  startsOn: string;
  endsOn: string;
}) {
  const { error } = await getSupabase()
    .from('academic_years')
    .insert({ label: input.label, starts_on: input.startsOn, ends_on: input.endsOn });
  if (error) {
    throw error;
  }
}

export async function fetchStudents(schoolId: string, search: string, page: number) {
  let query = getSupabase()
    .from('students')
    .select(
      'id, full_name, student_code, admission_number, gender, status, has_special_needs, family_sign_in_active, enrolments(ended_on, class_sections(grade, section, academic_years(label)))',
      { count: 'exact' },
    )
    .eq('school_id', schoolId)
    .is('enrolments.ended_on', null)
    .order('full_name')
    .order('id')
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  const term = searchTerm(search);
  if (term) {
    query = query.or(
      `full_name.ilike.*${term}*,student_code.ilike.*${term}*,admission_number.ilike.*${term}*`,
    );
  }
  const { data, error, count } = await query;
  if (error) {
    throw error;
  }
  return { rows: data, total: count ?? 0 };
}

export interface StudentImportResult {
  rows: number;
  created: number;
  skipped_existing: number;
  classes_created: number;
}

export async function importStudents(
  schoolId: string,
  academicYearId: string,
  rows: Record<string, string>[],
): Promise<StudentImportResult> {
  const { data, error } = await getSupabase().rpc('import_students', {
    target_school_id: schoolId,
    target_academic_year_id: academicYearId,
    rows: rows as Json,
  });
  if (error) {
    rethrowImportError(error);
  }
  return data as unknown as StudentImportResult;
}

export function issueFamilyLogin(studentId: string) {
  return callFunction<{ student_id: string; full_name: string; learner_code: string; pin: string }>(
    'account-admin',
    { action: 'issue_family_login', student_id: studentId },
  );
}

export function revokeFamilyLogin(studentId: string) {
  return callFunction<{ student_id: string }>('account-admin', {
    action: 'revoke_family_login',
    student_id: studentId,
  });
}

// ---------------------------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------------------------

/** Audit events, newest first; `table` is a table name or `all`. */
export async function fetchAuditEvents(table: string, page: number) {
  let query = getSupabase()
    .from('audit_events')
    .select('id, occurred_at, actor_id, actor_role, table_name, operation, record_id, changes', {
      count: 'exact',
    })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (table !== 'all') {
    query = query.eq('table_name', table);
  }
  const { data, error, count } = await query;
  if (error) {
    throw error;
  }

  const actorIds = [...new Set(data.flatMap((event) => (event.actor_id ? [event.actor_id] : [])))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const profiles = await getSupabase()
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds);
    if (profiles.error) {
      throw profiles.error;
    }
    for (const profile of profiles.data) {
      names.set(profile.id, profile.full_name);
    }
  }
  return {
    rows: data.map((event) => ({
      ...event,
      actor_name: event.actor_id ? (names.get(event.actor_id) ?? null) : null,
    })),
    total: count ?? 0,
  };
}
