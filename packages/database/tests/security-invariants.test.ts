import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './support/database';

/**
 * Properties that must hold for every object in the schema, so that a table or function added in a
 * later migration cannot silently weaken access control.
 */
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/** Functions that may be called without signing in. */
const anonymousFunctions = ['public.service_status'];

/** Functions of the public schema that signed-in users may call through the Data API. */
const signedInFunctions = [
  'public.admin_overview',
  'public.area_report',
  'public.child_progress',
  'public.class_progress',
  'public.crp_class_signal',
  'public.exam_marks_checks',
  'public.exam_marks_pulse',
  'public.family_sign_in_active',
  'public.import_schools',
  'public.import_students',
  'public.keep_push_subscription',
  'public.move_exam_paper',
  'public.my_access',
  'public.my_attendance',
  'public.my_demo',
  'public.my_schools_overview',
  'public.pulse_items_seen',
  'public.remove_exam',
  'public.save_exam',
  'public.save_exam_marks',
  'public.save_visit',
  'public.service_status',
  'public.transfer_assignment',
];

describe('schema security invariants', () => {
  it('enables row level security on every table in the public schema', async () => {
    const rows = await database.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    `);
    expect(rows).toEqual([]);
  });

  it('gives anonymous visitors no access to any table, view or sequence', async () => {
    const rows = await database.query<{ object_name: string }>(`
      select n.nspname || '.' || c.relname as object_name
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private')
        and c.relkind in ('r', 'p', 'v', 'm', 'S')
        and (
          has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE'))
        )
    `);
    expect(rows).toEqual([]);
  });

  it('lets anonymous visitors call only the allow-listed functions', async () => {
    const rows = await database.query<{ function_name: string }>(`
      select n.nspname || '.' || p.proname as function_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    `);
    expect(rows.map((row) => row.function_name).sort()).toEqual(anonymousFunctions);
  });

  it('lets signed-in users call only the allow-listed public functions', async () => {
    const rows = await database.query<{ function_name: string }>(`
      select n.nspname || '.' || p.proname as function_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    `);
    expect(rows.map((row) => row.function_name).sort()).toEqual(signedInFunctions);
  });

  it('reserves service functions for the secret key', async () => {
    const rows = await database.query<{ function_name: string; executable: boolean }>(`
      select p.proname as function_name,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as executable
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and starts_with(p.proname, 'service_')
        and p.proname <> 'service_status'
      order by p.proname
    `);
    expect(rows).toEqual([
      { function_name: 'service_demo_account', executable: true },
      { function_name: 'service_demo_account_deleted', executable: true },
      { function_name: 'service_demo_accounts_to_delete', executable: true },
      { function_name: 'service_demo_build', executable: true },
      { function_name: 'service_demo_due', executable: true },
      { function_name: 'service_demo_expire', executable: true },
      { function_name: 'service_demo_note_account', executable: true },
      { function_name: 'service_demo_open', executable: true },
      { function_name: 'service_demo_remove', executable: true },
      { function_name: 'service_demo_removing', executable: true },
      { function_name: 'service_demo_sandbox_of', executable: true },
      { function_name: 'service_is_demo_account', executable: true },
      { function_name: 'service_job_token_valid', executable: true },
      { function_name: 'service_mark_pulse_audio_removed', executable: true },
      { function_name: 'service_mark_visit_notes_removed', executable: true },
      { function_name: 'service_pulse_agreement', executable: true },
      { function_name: 'service_pulse_audio_to_remove', executable: true },
      { function_name: 'service_pulse_checks_to_score', executable: true },
      { function_name: 'service_push_outcome', executable: true },
      { function_name: 'service_push_recipients', executable: true },
      { function_name: 'service_record_pulse_score_failure', executable: true },
      { function_name: 'service_record_visit_note_failure', executable: true },
      { function_name: 'service_return_ai_quota', executable: true },
      { function_name: 'service_revoke_family_pin', executable: true },
      { function_name: 'service_save_visit_note_transcript', executable: true },
      { function_name: 'service_set_family_pin', executable: true },
      { function_name: 'service_take_ai_quota', executable: true },
      { function_name: 'service_verify_family_pin', executable: true },
      { function_name: 'service_visit_notes_to_remove', executable: true },
      { function_name: 'service_visit_notes_to_transcribe', executable: true },
    ]);
  });

  it('keeps private tables away from API roles', async () => {
    const rows = await database.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'private'
        and c.relkind = 'r'
        and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
             or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    `);
    expect(rows).toEqual([]);
  });

  it('keeps every private function away from the PUBLIC pseudo-role', async () => {
    const rows = await database.query<{ function_name: string }>(`
      select p.proname as function_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
      where n.nspname = 'private' and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    `);
    expect(rows).toEqual([]);
  });

  it('fixes the search path of every SECURITY DEFINER function', async () => {
    const rows = await database.query<{ function_name: string }>(`
      select n.nspname || '.' || p.proname as function_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) as setting
          where setting = 'search_path=""'
        )
    `);
    expect(rows).toEqual([]);
  });

  it('exposes no SECURITY DEFINER function through the public schema', async () => {
    const rows = await database.query<{ function_name: string }>(`
      select p.proname as function_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
    `);
    expect(rows).toEqual([]);
  });

  it('backs every foreign key with an index that starts with its columns', async () => {
    const rows = await database.query<{ constraint_name: string }>(`
      select con.conname as constraint_name
      from pg_constraint as con
      join pg_namespace as n on n.oid = con.connamespace
      where con.contype = 'f'
        and n.nspname = 'public'
        and not exists (
          select 1
          from pg_index as i
          where i.indrelid = con.conrelid
            and i.indpred is null
            and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)]
              = con.conkey
        )
    `);
    expect(rows).toEqual([]);
  });

  it('reserves the bootstrap, scheduling and retention functions for the database owner', async () => {
    const rows = await database.query<{ role: string; function_name: string }>(`
      select r.role, p.proname as function_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('service_role')) as r (role)
      where n.nspname = 'private'
        and p.proname in (
          'bootstrap_super_admin',
          'purge_expired_audit_events',
          'draw_pulse_cycle',
          'replace_pulse_samples',
          'run_pulse_schedule',
          'request_pulse_retention',
          'request_notifications',
          'request_demo_sweep',
          'purge_ai_usage'
        )
        and has_function_privilege(r.role, p.oid, 'EXECUTE')
    `);
    expect(rows).toEqual([]);
  });

  it('answers the service status check for anonymous visitors', async () => {
    await database.begin();
    try {
      const [row] = await database.as({ kind: 'anon' }, (query) =>
        query<{ status: { status: string } }>('select public.service_status() as status'),
      );
      expect(row?.status.status).toBe('ok');
    } finally {
      await database.rollback();
    }
  });
});
