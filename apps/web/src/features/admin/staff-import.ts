import { normaliseMobile } from '@shared/accounts.ts';
import type { StaffRole } from '@/features/auth/access';
import {
  createStaff,
  ImportRejectedError,
  resolveScopeCodes,
  type ImportProblem,
  type StaffCreationOutcome,
  type StaffDraft,
} from './admin-api';
import type { ImportColumn } from './import-panel';
import { isStaffRole } from './staff-roles';

export const STAFF_COLUMNS: ImportColumn[] = [
  { name: 'full_name', required: true },
  { name: 'mobile', required: true },
  { name: 'role', required: true },
  { name: 'scope_code', required: false },
  { name: 'preferred_language', required: false },
  { name: 'starts_on', required: false },
];

interface ParsedRow {
  row: number;
  fullName: string;
  mobile: string;
  role: StaffRole;
  scopeCode: string | null;
  language: 'en' | 'hi';
  startsOn: string | null;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Checks every row of a staff file without contacting the server. Rows are numbered from 1 for the
 * first data row, as the database does for its own imports.
 */
export function validateStaffRows(records: Record<string, string>[]): {
  rows: ParsedRow[];
  problems: ImportProblem[];
} {
  const problems: ImportProblem[] = [];
  const rows: ParsedRow[] = [];
  const mobileRows = new Map<string, number[]>();

  records.forEach((record, index) => {
    const row = index + 1;
    const fullName = record.full_name ?? '';
    const mobile = normaliseMobile(record.mobile ?? '');
    const roleText = (record.role ?? '').trim().toLowerCase();
    const scopeCode = (record.scope_code ?? '').trim().toUpperCase() || null;
    const languageText = (record.preferred_language ?? '').trim().toLowerCase();
    const startsOn = (record.starts_on ?? '').trim() || null;
    let valid = true;

    if (fullName === '') {
      problems.push({ row, field: 'full_name', issue: 'required' });
      valid = false;
    } else if (fullName.length > 120) {
      problems.push({ row, field: 'full_name', issue: 'format' });
      valid = false;
    }
    if (!mobile) {
      problems.push({
        row,
        field: 'mobile',
        issue: (record.mobile ?? '') === '' ? 'required' : 'format',
      });
      valid = false;
    } else {
      mobileRows.set(mobile, [...(mobileRows.get(mobile) ?? []), row]);
    }
    if (!isStaffRole(roleText)) {
      problems.push({ row, field: 'role', issue: roleText === '' ? 'required' : 'format' });
      valid = false;
    } else if (roleText !== 'super_admin' && !scopeCode) {
      problems.push({ row, field: 'scope_code', issue: 'required' });
      valid = false;
    }
    if (languageText !== '' && languageText !== 'hi' && languageText !== 'en') {
      problems.push({ row, field: 'preferred_language', issue: 'format' });
      valid = false;
    }
    if (startsOn && !isCalendarDate(startsOn)) {
      problems.push({ row, field: 'starts_on', issue: 'format' });
      valid = false;
    }

    if (valid && mobile && isStaffRole(roleText)) {
      rows.push({
        row,
        fullName,
        mobile,
        role: roleText,
        scopeCode: roleText === 'super_admin' ? null : scopeCode,
        language: languageText === 'en' ? 'en' : 'hi',
        startsOn,
      });
    }
  });

  for (const repeated of mobileRows.values()) {
    if (repeated.length > 1) {
      for (const row of repeated) {
        problems.push({ row, field: 'mobile', issue: 'duplicate' });
      }
    }
  }

  problems.sort((a, b) => a.row - b.row || a.field.localeCompare(b.field));
  return { rows, problems };
}

export interface StaffImportResult {
  outcomes: (StaffCreationOutcome & { row: number; fullName: string })[];
}

/**
 * Validates the file, resolves every scope code to a record, and only then creates the accounts.
 * Problems found before creation reject the whole file; accounts refused during creation (for
 * example a mobile number registered meanwhile) are reported per row.
 */
export async function importStaff(records: Record<string, string>[]): Promise<StaffImportResult> {
  const { rows, problems } = validateStaffRows(records);
  if (problems.length > 0) {
    throw new ImportRejectedError(problems);
  }

  const resolved = await resolveScopeCodes(
    rows.flatMap((row) => (row.scopeCode ? [{ role: row.role, code: row.scopeCode }] : [])),
  );
  const scopeProblems: ImportProblem[] = [];
  const drafts: StaffDraft[] = rows.map((row) => {
    let scopeId: string | null = null;
    if (row.scopeCode) {
      const match = resolved.get(`${row.role}:${row.scopeCode}`);
      if (match === 'unknown' || match === 'ambiguous' || match === undefined) {
        scopeProblems.push({ row: row.row, field: 'scope_code', issue: match ?? 'unknown' });
      } else {
        scopeId = match.id;
      }
    }
    return {
      full_name: row.fullName,
      mobile: row.mobile,
      role: row.role,
      scope_id: scopeId,
      preferred_language: row.language,
      ...(row.startsOn ? { starts_on: row.startsOn } : {}),
    };
  });
  if (scopeProblems.length > 0) {
    throw new ImportRejectedError(scopeProblems);
  }

  const outcomes = await createStaff(drafts);
  return {
    outcomes: outcomes.map((outcome) => {
      const source = rows[outcome.index];
      return {
        ...outcome,
        row: source?.row ?? outcome.index + 1,
        fullName: source?.fullName ?? '',
      };
    }),
  };
}
