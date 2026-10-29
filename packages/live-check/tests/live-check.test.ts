import { describe, expect, it } from 'vitest';
import { cleanupSql, leftoversSql, toLeftovers } from '../src/cleanup.ts';
import { aiUnavailableReason, answered } from '../src/clients.ts';
import { cliErrorMessage, parseRows } from '../src/database-cli.ts';
import { localMigrationVersions, pendingMigrations } from '../src/migrations.ts';
import {
  academicSessionFor,
  differentPin,
  newMobileNumber,
  newPassword,
  newRunTag,
  newUdiseCode,
} from '../src/values.ts';

describe('reading the Supabase CLI output', () => {
  it('accepts the plain array printed in a terminal', () => {
    expect(parseRows('[\n  {\n    "ready": 1\n  }\n]\n')).toEqual([{ ready: 1 }]);
  });

  it('accepts the wrapped form printed under automation tools', () => {
    expect(parseRows('{"boundary":"x","rows":[{"ready":1}],"warning":"..."}')).toEqual([
      { ready: 1 },
    ]);
  });

  it('accepts a statement without rows', () => {
    expect(parseRows('[]\n')).toEqual([]);
    expect(parseRows('{"rows":[]}')).toEqual([]);
  });

  it('refuses the table format instead of reading it as no rows', () => {
    expect(parseRows('┌───────┐\n│ ready │\n├───────┤\n│ 1     │\n└───────┘\n')).toBeNull();
    expect(parseRows('')).toBeNull();
  });

  it('reports the error from standard error without progress notes', () => {
    expect(
      cliErrorMessage(
        '',
        'Initialising login role...\nunexpected status 400: column "x" does not exist\nTry rerunning the command with --debug to troubleshoot the error.\n',
      ),
    ).toBe('unexpected status 400: column "x" does not exist');
  });

  it('reports the error from JSON output', () => {
    expect(cliErrorMessage('{"_tag":"Error","error":{"message":"denied"}}', '')).toBe('denied');
  });
});

describe('removing the records of a run', () => {
  const run = {
    staffEmails: ['m9876543210@staff.agla-kadam.invalid'],
    createdAcademicYearId: null,
  };

  it('is a single transaction that removes the audit history last', () => {
    const sql = cleanupSql(run);
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql.lastIndexOf('delete from public.audit_events')).toBeGreaterThan(
      sql.lastIndexOf('delete from public.states'),
    );
  });

  it('removes only sessions a live check added, and only while no class uses them', () => {
    const sql = cleanupSql(run);
    // An interrupted run cannot say which session it added: the audit history names its
    // temporary administrator, and is removed only after the session.
    expect(sql).toContain("a.table_name = 'academic_years'");
    expect(sql).toContain('a.actor_id in (select id from lc_users)');
    expect(sql).toContain('not exists (select 1 from public.class_sections');
    expect(sql.indexOf('delete from public.academic_years')).toBeLessThan(
      sql.indexOf('delete from public.audit_events'),
    );
    expect(sql).not.toContain('or y.id =');

    const withSession = cleanupSql({
      ...run,
      createdAcademicYearId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    });
    expect(withSession).toContain("or y.id = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'::uuid");
  });

  it('refuses values that could change the statement', () => {
    expect(() => cleanupSql({ ...run, staffEmails: ["x'; drop table public.states; --"] })).toThrow(
      /unexpected value/,
    );
    expect(() => cleanupSql({ ...run, createdAcademicYearId: "1' or '1'='1" })).toThrow(
      /unexpected identifier/,
    );
    expect(() => leftoversSql(run, ['not-a-uuid'])).toThrow(/unexpected identifier/);
  });

  it('reads the leftover counts', () => {
    expect(toLeftovers({ states: 0, schools: 0, accounts: 1, audit_events: 2 })).toEqual({
      states: 0,
      schools: 0,
      accounts: 1,
      auditEvents: 2,
    });
    expect(Number.isNaN(toLeftovers(undefined).states)).toBe(true);
  });
});

describe('migrations of this code', () => {
  it('lists the migration files by version, oldest first', async () => {
    const versions = await localMigrationVersions();
    expect(versions.length).toBeGreaterThan(10);
    expect(versions).toEqual([...versions].sort());
    expect(versions.every((version) => /^\d{14}$/.test(version))).toBe(true);
    expect(versions).toContain('20261018160000');
  });

  it('names the versions the database has not applied', () => {
    expect(pendingMigrations(['1', '2', '3'], ['1', '2', '3'])).toEqual([]);
    expect(pendingMigrations(['1', '2', '3'], ['1'])).toEqual(['2', '3']);
    expect(pendingMigrations(['1', '2'], ['1', '2', '0'])).toEqual([]);
  });
});

describe('test values', () => {
  it('mark a run with four capital letters', () => {
    expect(newRunTag()).toMatch(/^[A-Z]{4}$/);
  });

  it('use valid formats', () => {
    expect(newMobileNumber()).toMatch(/^[6-9][0-9]{9}$/);
    expect(newUdiseCode()).toMatch(/^99[0-9]{9}$/);
    const password = newPassword();
    expect(password).toHaveLength(16);
    expect(password).toMatch(/[A-Za-z]/);
    expect(password).toMatch(/[0-9]/);
  });

  it('give a PIN that always differs', () => {
    for (const pin of ['000000', '482915', '999999']) {
      const other = differentPin(pin);
      expect(other).toMatch(/^[0-9]{6}$/);
      expect(other).not.toBe(pin);
    }
  });

  it('find the April-to-March academic session', () => {
    expect(academicSessionFor('2026-10-18')).toEqual({
      label: '2026-27',
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
    });
    expect(academicSessionFor('2027-03-31').label).toBe('2026-27');
    expect(academicSessionFor('2027-04-01').label).toBe('2027-28');
    expect(academicSessionFor('2099-06-01').label).toBe('2099-00');
  });
});

describe('answers of the language-model services', () => {
  const unavailable = (seconds: number) => ({
    status: 503,
    body: { error: { code: 'ai_unavailable', retry_after_seconds: seconds } },
  });

  it('names why a service could not be reached, from the wait the function asks for', () => {
    expect(aiUnavailableReason(unavailable(60))).toMatch(/rate limit/);
    expect(aiUnavailableReason(unavailable(20))).toMatch(/did not answer in time/);
    expect(aiUnavailableReason(unavailable(3600))).toMatch(/used up/);
    expect(answered(unavailable(60))).toBe(
      '503 (ai_unavailable: the service is limiting requests (a passing rate limit))',
    );
  });

  it('says nothing more for any other answer', () => {
    expect(aiUnavailableReason({ status: 200, body: {} })).toBeNull();
    expect(answered({ status: 403, body: { error: { code: 'forbidden' } } })).toBe(
      '403 (forbidden)',
    );
  });
});
