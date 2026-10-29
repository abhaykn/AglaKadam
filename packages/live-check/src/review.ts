import { staffEmailForMobile, todayInIndia } from '../../../supabase/functions/_shared/accounts.ts';
import type { RunState } from './check.ts';
import { answered, asRecord, connections, type Client } from './clients.ts';
import { runSql } from './database-cli.ts';
import type { Environment } from './environment.ts';
import { CheckFailure, expect, type Report } from './report.ts';
import { academicSessionFor, newMobileNumber, newPassword, newUdiseCode } from './values.ts';

/**
 * A complete, temporary set-up for reviewing every screen by hand: one school with a Grade 2 class
 * whose month of Pulse is drawn, and an account for every role. Everything is marked "Live check"
 * like the automated check, and removed by the same statement when the review ends.
 */

export interface ReviewAccount {
  role: string;
  /** What to type in the first field of the sign-in page. */
  signInWith: string;
  secret: string;
  note: string;
}

export interface Review {
  classSectionId: string;
  accounts: ReviewAccount[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Passwords short enough to type on a phone, still within the project's rules. */
const PASSWORD_LENGTH = 10;
const LEARNERS = 8;

type StaffRole = 'district_officer' | 'block_officer' | 'crp' | 'teacher';

const ROLE_NAMES: Record<StaffRole, string> = {
  district_officer: 'District officer',
  block_officer: 'Block officer',
  crp: 'CRP',
  teacher: 'Teacher',
};

export async function prepareReview(
  environment: Environment,
  secretKey: string,
  report: Report,
  run: RunState,
): Promise<Review> {
  const { service, signIn, invoke } = connections(environment, secretKey);
  const tag = run.tag;
  const today = todayInIndia();
  const accounts: ReviewAccount[] = [];

  const adminPassword = newPassword(PASSWORD_LENGTH);
  const administrator = await report.check('A temporary administrator is created', async () => {
    const email = `live-check-${tag.toLowerCase()}@agla-kadam.invalid`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: adminPassword,
      email_confirm: true,
      app_metadata: {
        provisioning: {
          account_kind: 'staff',
          full_name: `Live check ${tag} administrator`,
          preferred_language: 'en',
          password_change_required: false,
          assignment: { role: 'super_admin', scope_id: null },
        },
      },
    });
    expect(error === null, `The account could not be created (${error?.message ?? ''}).`);
    run.userIds.push(data.user.id);
    accounts.push({
      role: 'Super administrator',
      signInWith: email,
      secret: adminPassword,
      note: 'Staff tab, then "Main administrator? Sign in with email".',
    });
    return signIn(email, adminPassword);
  });

  const academicYearId = await report.check('The current academic session is ready', async () => {
    const { data: current, error } = await administrator
      .from('academic_years')
      .select('id, label')
      .lte('starts_on', today)
      .gte('ends_on', today)
      .limit(1);
    expect(error === null, `Academic sessions could not be read (${error?.message ?? ''}).`);
    const [existing] = current;
    if (existing) {
      report.note(`Uses the existing session ${existing.label}; it is kept.`);
      return existing.id;
    }
    const session = academicSessionFor(today);
    const { data: created, error: insertError } = await administrator
      .from('academic_years')
      .insert({ label: session.label, starts_on: session.startsOn, ends_on: session.endsOn })
      .select('id')
      .single();
    expect(insertError === null, `The session could not be added (${insertError?.message ?? ''}).`);
    run.createdAcademicYearId = created.id;
    report.note(`Added the session ${session.label} for the review; it is removed afterwards.`);
    return created.id;
  });

  const place = await report.check('A school is imported', async () => {
    const udiseCode = newUdiseCode();
    const { error } = await administrator.rpc('import_schools', {
      rows: [
        {
          state_code: `LC${tag}S`,
          state_name: `Live check ${tag} state`,
          district_code: `LC${tag}D`,
          district_name: `Live check ${tag} district`,
          block_code: `LC${tag}B`,
          block_name: `Live check ${tag} block`,
          cluster_code: `LC${tag}C`,
          cluster_name: `Live check ${tag} cluster`,
          udise_code: udiseCode,
          school_name: `Live check ${tag} school`,
        },
      ],
    });
    expect(error === null, `import_schools failed (${error?.message ?? ''}).`);
    const { data: school, error: schoolError } = await administrator
      .from('schools')
      .select('id, cluster_id')
      .eq('udise_code', udiseCode)
      .single();
    expect(schoolError === null, `The school could not be read (${schoolError?.message ?? ''}).`);
    const { data: cluster, error: clusterError } = await administrator
      .from('clusters')
      .select('block_id')
      .eq('id', school.cluster_id)
      .single();
    expect(
      clusterError === null,
      `The cluster could not be read (${clusterError?.message ?? ''}).`,
    );
    const { data: block, error: blockError } = await administrator
      .from('blocks')
      .select('district_id')
      .eq('id', cluster.block_id)
      .single();
    expect(blockError === null, `The block could not be read (${blockError?.message ?? ''}).`);
    return {
      schoolId: school.id,
      clusterId: school.cluster_id,
      blockId: cluster.block_id,
      districtId: block.district_id,
    };
  });

  /** Creates a staff account; unless kept on its temporary password, sets a known one. */
  const createStaff = async (
    role: StaffRole,
    scopeId: string,
    keepTemporary = false,
  ): Promise<Client | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const mobile = newMobileNumber();
      const email = staffEmailForMobile(mobile);
      run.staffEmails.push(email);
      const result = await invoke(administrator, 'account-admin', {
        action: 'create_staff',
        accounts: [
          {
            full_name: `Live check ${tag} ${ROLE_NAMES[role]}`,
            mobile,
            role,
            scope_id: scopeId,
            preferred_language: 'en',
          },
        ],
      });
      expect(result.status === 200, `create_staff answered ${answered(result)}.`);
      const outcomes = result.body.results;
      const fields = asRecord(Array.isArray(outcomes) ? outcomes[0] : undefined, 'create_staff');
      if (fields.status === 'failed' && fields.error === 'mobile_in_use') {
        continue;
      }
      const userId = fields.user_id;
      const temporaryPassword = fields.temporary_password;
      expect(
        fields.status === 'created' &&
          typeof userId === 'string' &&
          typeof temporaryPassword === 'string',
        `The ${ROLE_NAMES[role]} account was not created (${String(fields.error)}).`,
      );
      run.userIds.push(userId);
      if (keepTemporary) {
        accounts.push({
          role: ROLE_NAMES[role],
          signInWith: mobile,
          secret: temporaryPassword,
          note: 'Temporary password: the app asks for a new one first.',
        });
        return null;
      }
      const client = await signIn(email, temporaryPassword);
      const password = newPassword(PASSWORD_LENGTH);
      const changed = await invoke(client, 'account-password', { new_password: password });
      expect(changed.status === 200, `The password service answered ${answered(changed)}.`);
      accounts.push({ role: ROLE_NAMES[role], signInWith: mobile, secret: password, note: '' });
      return signIn(email, password);
    }
    throw new CheckFailure('Three random mobile numbers were all in use; run the review again.');
  };

  const staff = await report.check('An account is created for every staff role', async () => {
    await createStaff('district_officer', place.districtId);
    await createStaff('block_officer', place.blockId, true);
    const crp = await createStaff('crp', place.clusterId);
    const teacher = await createStaff('teacher', place.schoolId);
    expect(crp !== null && teacher !== null, 'The CRP and the teacher could not sign in.');
    return { crp, teacher };
  });

  const learners = await report.check('The CRP imports a class list', async () => {
    const rows = Array.from({ length: LEARNERS }, (_, index) => ({
      full_name: `Live check ${tag} learner ${String(index + 1)}`,
      gender: index % 2 === 0 ? 'female' : 'male',
      grade: '2',
      section: 'A',
      // The last child has special needs, for the adapted check.
      has_special_needs: index === LEARNERS - 1 ? 'yes' : '',
    }));
    const { data, error } = await staff.crp.rpc('import_students', {
      target_school_id: place.schoolId,
      target_academic_year_id: academicYearId,
      rows,
    });
    expect(error === null, `import_students failed (${error?.message ?? ''}).`);
    expect(
      asRecord(data, 'import_students').created === LEARNERS,
      'Not every learner was created.',
    );
    const { data: students, error: readError } = await staff.teacher
      .from('students')
      .select('id, full_name, has_special_needs')
      .eq('school_id', place.schoolId)
      .order('full_name');
    expect(readError === null, `The learners could not be read (${readError?.message ?? ''}).`);
    const { data: sections, error: sectionError } = await staff.teacher
      .from('class_sections')
      .select('id')
      .eq('school_id', place.schoolId);
    expect(sectionError === null, `The class could not be read (${sectionError?.message ?? ''}).`);
    const [section] = sections;
    expect(section !== undefined, 'The class was not found.');
    return { students, classSectionId: section.id };
  });

  await report.check('Guardians consent to audio checks, and the month is drawn', async () => {
    for (const learner of learners.students.filter((entry) => !entry.has_special_needs)) {
      const { error } = await staff.teacher.from('guardian_consents').insert({
        student_id: learner.id,
        purpose: 'audio_assessment',
        granted: true,
        guardian_name: `Live check ${tag} guardian`,
        method: 'paper_form',
      });
      expect(error === null, `Consent was not recorded (${error?.message ?? ''}).`);
    }
    const ids = learners.students.map((learner) => learner.id);
    expect(
      ids.every((id) => UUID_PATTERN.test(id)) && UUID_PATTERN.test(learners.classSectionId),
      'The learners have unexpected identifiers.',
    );
    // Enrolled from the first of the month, so that the draw counts them whatever today's date.
    await runSql(
      `update public.enrolments set enrolled_on = date_trunc('month', private.today())::date
       where student_id in (${ids.map((id) => `'${id}'::uuid`).join(', ')});
       select private.draw_pulse_cycle('${learners.classSectionId}'::uuid,
         least(private.today(), date_trunc('month', private.today())::date + 27))`,
    );
    const { data: cycle, error } = await staff.teacher
      .from('pulse_cycles')
      .select('sample_size')
      .eq('class_section_id', learners.classSectionId)
      .single();
    expect(error === null, `The month was not drawn (${error?.message ?? ''}).`);
    report.note(`${String(cycle.sample_size)} children are drawn for this month.`);
  });

  await report.check('The teacher issues a family sign-in slip', async () => {
    const [first] = learners.students;
    expect(first !== undefined, 'There is no learner for the slip.');
    const result = await invoke(staff.teacher, 'account-admin', {
      action: 'issue_family_login',
      student_id: first.id,
    });
    expect(result.status === 200, `issue_family_login answered ${answered(result)}.`);
    const { learner_code: learnerCode, pin } = result.body;
    expect(
      typeof learnerCode === 'string' && typeof pin === 'string',
      'The slip has no learner code or PIN.',
    );
    const { data } = await service
      .from('students')
      .select('auth_user_id')
      .eq('id', first.id)
      .single();
    if (data?.auth_user_id) {
      run.userIds.push(data.auth_user_id);
    }
    accounts.push({
      role: 'Student and parent',
      signInWith: learnerCode,
      secret: pin,
      note: `"Parent or student" tab; ${first.full_name}.`,
    });
  });

  return { classSectionId: learners.classSectionId, accounts };
}

/** The recordings made during the review, to be removed with the rest. */
export async function reviewRecordings(classSectionId: string): Promise<string[]> {
  if (!UUID_PATTERN.test(classSectionId)) {
    return [];
  }
  const rows = await runSql(
    `select name from storage.objects
     where bucket_id = 'pulse-audio' and name like '${classSectionId}/%'`,
  );
  return rows.map((row) => String(row.name));
}

/**
 * The voice notes recorded on the review's visits, to be removed with the rest. They are read
 * before the visits are removed, since a note's file is named after its visit.
 */
export async function reviewVoiceNotes(classSectionId: string): Promise<string[]> {
  if (!UUID_PATTERN.test(classSectionId)) {
    return [];
  }
  const rows = await runSql(
    `select o.name from storage.objects as o
     where o.bucket_id = 'visit-notes'
       and split_part(o.name, '/', 1) in (
         select v.id::text from public.visits as v
         where v.class_section_id = '${classSectionId}'
       )`,
  );
  return rows.map((row) => String(row.name));
}
