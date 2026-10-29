import { openWeek } from '../../../apps/web/src/features/pulse/week-batch.ts';
import { staffEmailForMobile, todayInIndia } from '../../../supabase/functions/_shared/accounts.ts';
import type { RunRecords } from './cleanup.ts';
import { answered, asRecord, connections, errorCodeOf, type Client } from './clients.ts';
import { runSql } from './database-cli.ts';
import type { Environment } from './environment.ts';
import { CheckFailure, expect, type Report } from './report.ts';
import {
  academicSessionFor,
  differentPin,
  newMobileNumber,
  newPassword,
  newUdiseCode,
} from './values.ts';

export interface RunState extends RunRecords {
  /** Four capital letters that mark every record of the run. */
  tag: string;
  /** Every account the run created, for the final count of leftovers. */
  userIds: string[];
  /** Pulse recordings the run uploaded, removed through the Storage API at the end. */
  pulseFiles: string[];
  /** Voice notes of visits the run uploaded, removed the same way. */
  noteFiles: string[];
}

const PULSE_BUCKET = 'pulse-audio';
const NOTES_BUCKET = 'visit-notes';
const CLASS_NOTES_BUCKET = 'class-notes';
/** A white 64 by 64 PNG, for a photo without any order on it. */
const BLANK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PMQ0AAAwDoPo33UrYvQQckD4XAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYHLAMpT0sIcNbcEAAAAAElFTkSuQmCC';
/** The longest list the engine's service functions return at once. */
const ENGINE_LIST_LIMIT = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a Storage error says the file is already there (an earlier attempt uploaded it). */
function isAlreadyStored(error: {
  message: string;
  status?: number | undefined;
  statusCode?: string | undefined;
}): boolean {
  return (
    error.status === 409 ||
    error.statusCode === '409' ||
    /already exists|duplicate/i.test(error.message)
  );
}

interface StaffAccount {
  userId: string;
  email: string;
  temporaryPassword: string;
}

function hasRole(access: Record<string, unknown>, role: string): boolean {
  const assignments = access.assignments;
  return (
    Array.isArray(assignments) &&
    assignments.some(
      (assignment: unknown) =>
        typeof assignment === 'object' &&
        assignment !== null &&
        (assignment as { role?: unknown }).role === role,
    )
  );
}

/**
 * The end-to-end check. Each step uses the same paths as the web app: password sign-in, the Edge
 * Functions and the database functions, each as the person who would use them, so that row-level
 * security is exercised exactly as in daily use. Only the temporary administrator is created with
 * the secret key, because the first administrator of a project cannot be created any other way.
 */
export async function runLiveCheck(
  environment: Environment,
  secretKey: string,
  report: Report,
  run: RunState,
): Promise<void> {
  const { newClient, visitor, service, signIn, invoke, invokeAi } = connections(
    environment,
    secretKey,
  );
  const tag = run.tag;
  const today = todayInIndia();

  const refusalOf = async (email: string, password: string): Promise<string> => {
    const client = newClient(environment.publishableKey);
    const { error } = await client.auth.signInWithPassword({ email, password });
    expect(error !== null, 'Sign-in succeeded although it should have been refused.');
    return error.code ?? error.message;
  };

  const accessOf = async (client: Client): Promise<Record<string, unknown>> => {
    const { data, error } = await client.rpc('my_access');
    expect(error === null, `my_access failed: ${error?.message ?? ''}`);
    return asRecord(data, 'my_access');
  };

  /** Whether the console shows the learner's family sign-in as switched on. */
  const familySignInShownBy = async (client: Client, studentId: string): Promise<boolean> => {
    const { data, error } = await client
      .from('students')
      .select('id, family_sign_in_active')
      .eq('id', studentId)
      .single();
    expect(error === null, `The learner could not be read (${error?.message ?? ''}).`);
    return data.family_sign_in_active === true;
  };

  const overviewOf = async (client: Client) => {
    const { data, error } = await client.rpc('my_schools_overview');
    expect(error === null, `my_schools_overview failed: ${error?.message ?? ''}`);
    return data;
  };

  await report.check('The project answers', async () => {
    const { data, error } = await visitor.rpc('service_status');
    expect(error === null, `service_status failed: ${error?.message ?? ''}`);
    expect(asRecord(data, 'service_status').status === 'ok', 'service_status did not report ok.');
  });

  await report.check('The secret key belongs to this project', async () => {
    const { error } = await service.auth.admin.listUsers({ page: 1, perPage: 1 });
    expect(error === null, `The key was refused (${error?.message ?? ''}).`);
  });

  const administrator = await report.check('A temporary administrator signs in', async () => {
    const email = `live-check-${tag.toLowerCase()}@agla-kadam.invalid`;
    const password = newPassword(24);
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
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
    const client = await signIn(email, password);
    const access = await accessOf(client);
    expect(hasRole(access, 'super_admin'), 'The account did not receive the administrator role.');
    expect(access.password_change_required === false, 'The account must not need a change.');
    return client;
  });

  const academicYearId = await report.check(
    'The current academic session is available',
    async () => {
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
      expect(
        insertError === null,
        `The session could not be added (${insertError?.message ?? ''}).`,
      );
      run.createdAcademicYearId = created.id;
      report.note(`Added the session ${session.label} for the check; it is removed afterwards.`);
      return created.id;
    },
  );

  const school = await report.check('A school list is imported', async () => {
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
    const { data, error: readError } = await administrator
      .from('schools')
      .select('id, cluster_id')
      .eq('udise_code', udiseCode);
    expect(readError === null, `The school could not be read (${readError?.message ?? ''}).`);
    const [row] = data;
    expect(row !== undefined && data.length === 1, 'The imported school was not found.');
    return { id: row.id, clusterId: row.cluster_id };
  });

  const staff = await report.check(
    'Staff accounts are created with temporary passwords',
    async () => {
      const create = async (role: 'teacher' | 'crp', scopeId: string): Promise<StaffAccount> => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const mobile = newMobileNumber();
          const email = staffEmailForMobile(mobile);
          run.staffEmails.push(email);
          const result = await invoke(administrator, 'account-admin', {
            action: 'create_staff',
            accounts: [
              {
                full_name: `Live check ${tag} ${role === 'crp' ? 'CRP' : 'teacher'}`,
                mobile,
                role,
                scope_id: scopeId,
                preferred_language: 'en',
              },
            ],
          });
          expect(result.status === 200, `create_staff answered ${answered(result)}.`);
          const outcomes = result.body.results;
          const outcome: unknown = Array.isArray(outcomes) ? outcomes[0] : undefined;
          const fields = asRecord(outcome, 'create_staff');
          if (fields.status === 'failed' && fields.error === 'mobile_in_use') {
            continue;
          }
          const userId = fields.user_id;
          const temporaryPassword = fields.temporary_password;
          expect(
            fields.status === 'created' &&
              typeof userId === 'string' &&
              typeof temporaryPassword === 'string',
            `The ${role} account was not created (${String(fields.error)}).`,
          );
          run.userIds.push(userId);
          return { userId, email, temporaryPassword };
        }
        throw new CheckFailure('Three random mobile numbers were all in use; run the check again.');
      };
      return {
        teacher: await create('teacher', school.id),
        crp: await create('crp', school.clusterId),
      };
    },
  );

  const teacherOnIssuedPassword = await report.check(
    'A teacher on a temporary password sees no school data',
    async () => {
      const client = await signIn(staff.teacher.email, staff.teacher.temporaryPassword);
      const access = await accessOf(client);
      expect(access.password_change_required === true, 'The account was not marked for a change.');
      expect((await overviewOf(client)).length === 0, 'The account could see school data.');
      const attempt = await invoke(client, 'account-admin', {
        action: 'reset_staff_password',
        user_id: staff.crp.userId,
      });
      expect(attempt.status === 403, `An administrative action answered ${answered(attempt)}.`);
      return client;
    },
  );

  await report.check('A weak new password is refused', async () => {
    const result = await invoke(teacherOnIssuedPassword, 'account-password', {
      new_password: 'password',
    });
    expect(
      result.status === 422 && errorCodeOf(result) === 'weak_password',
      `The password service answered ${answered(result)}.`,
    );
  });

  const teacherPassword = newPassword();
  const teacher = await report.check(
    'The teacher sets a new password and gains access',
    async () => {
      const result = await invoke(teacherOnIssuedPassword, 'account-password', {
        new_password: teacherPassword,
      });
      expect(result.status === 200, `The password service answered ${answered(result)}.`);
      const refusal = await refusalOf(staff.teacher.email, staff.teacher.temporaryPassword);
      expect(refusal === 'invalid_credentials', `The old password was refused as "${refusal}".`);
      const client = await signIn(staff.teacher.email, teacherPassword);
      const access = await accessOf(client);
      expect(access.password_change_required === false, 'The change requirement remained.');
      const overview = await overviewOf(client);
      expect(
        overview.some((entry) => entry.school_id === school.id),
        'The teacher could not see their school.',
      );
      return client;
    },
  );

  const crp = await report.check(
    "The CRP sets a new password and sees the cluster's school",
    async () => {
      const first = await signIn(staff.crp.email, staff.crp.temporaryPassword);
      const result = await invoke(first, 'account-password', { new_password: newPassword() });
      expect(result.status === 200, `The password service answered ${answered(result)}.`);
      const overview = await overviewOf(first);
      expect(
        overview.some((entry) => entry.school_id === school.id),
        'The CRP could not see the school of their cluster.',
      );
      return first;
    },
  );

  const student = await report.check('The CRP imports a class list', async () => {
    const { data, error } = await crp.rpc('import_students', {
      target_school_id: school.id,
      target_academic_year_id: academicYearId,
      rows: [
        { full_name: `Live check ${tag} learner`, gender: 'female', grade: '1', section: 'A' },
      ],
    });
    expect(error === null, `import_students failed (${error?.message ?? ''}).`);
    expect(asRecord(data, 'import_students').created === 1, 'The learner was not created.');
    const { data: rows, error: readError } = await teacher
      .from('students')
      .select('id, student_code, status')
      .eq('school_id', school.id);
    expect(
      readError === null,
      `The teacher could not read learners (${readError?.message ?? ''}).`,
    );
    const [row] = rows;
    expect(row !== undefined && rows.length === 1, 'The teacher did not see the imported learner.');
    expect(row.status === 'active', `The learner was imported as "${row.status}".`);
    return row;
  });

  await report.check(
    "The teacher marks today's attendance without overwriting anyone else's",
    async () => {
      const { data: sections, error: sectionError } = await teacher
        .from('class_sections')
        .select('id')
        .eq('school_id', school.id);
      expect(sectionError === null, `Classes could not be read (${sectionError?.message ?? ''}).`);
      const [section] = sections;
      expect(section !== undefined, 'The imported class was not found.');
      const day = { class_section_id: section.id, attendance_date: today };
      const columns =
        'enrolled_count, present_count, absent_student_ids, updated_at, client_change_id';
      const changeId = crypto.randomUUID();

      // A new day is added (as the application does when the server had no record yet).
      const { data: added, error: addError } = await teacher
        .from('attendance_sessions')
        .insert({ ...day, absent_student_ids: [student.id], client_change_id: changeId })
        .select(columns)
        .single();
      expect(addError === null, `Attendance was not accepted (${addError?.message ?? ''}).`);
      expect(
        added.enrolled_count === 1 && added.present_count === 0,
        'The class roll was not counted by the server.',
      );
      expect(
        added.client_change_id === changeId,
        'The record does not carry the identifier of the save that wrote it.',
      );

      // A correction is applied only to the version it was based on.
      const { data: corrected, error: correctError } = await teacher
        .from('attendance_sessions')
        .update({ absent_student_ids: [] })
        .eq('class_section_id', section.id)
        .eq('attendance_date', today)
        .eq('updated_at', added.updated_at)
        .select(columns);
      expect(correctError === null, `The correction failed (${correctError?.message ?? ''}).`);
      expect(
        corrected.length === 1 && corrected[0]?.present_count === 1,
        'The correction was not applied to the version it was based on.',
      );

      // The same correction based on the older version changes nothing: a phone that synced late
      // cannot overwrite a newer record.
      const { data: stale, error: staleError } = await teacher
        .from('attendance_sessions')
        .update({ absent_student_ids: [student.id] })
        .eq('class_section_id', section.id)
        .eq('attendance_date', today)
        .eq('updated_at', added.updated_at)
        .select(columns);
      expect(staleError === null, `The check failed (${staleError?.message ?? ''}).`);
      expect(stale.length === 0, 'A change based on an older version overwrote the record.');

      // A second insert for the same day is refused rather than creating another record.
      const { error: duplicateError } = await teacher
        .from('attendance_sessions')
        .insert({ ...day, absent_student_ids: [] });
      expect(duplicateError?.code === '23505', 'A second record was accepted for the same day.');
    },
  );

  const pulse = await report.check(
    'Pulse draws the class and shows the child to the teacher',
    async () => {
      const { data: sections, error: sectionError } = await teacher
        .from('class_sections')
        .select('id')
        .eq('school_id', school.id);
      expect(sectionError === null, `Classes could not be read (${sectionError?.message ?? ''}).`);
      const classId = sections[0]?.id;
      expect(typeof classId === 'string' && UUID_PATTERN.test(classId), 'The class was not found.');

      // Only children whose guardian agreed to audio checks are drawn. The decision is sent the way
      // the app sends it, so a resend after a lost answer is recognised.
      const consent = {
        id: crypto.randomUUID(),
        student_id: student.id,
        purpose: 'audio_assessment',
        granted: true,
        guardian_name: `Live check ${tag} guardian`,
        method: 'paper_form',
      };
      let consentError: { message: string } | null = null;
      for (let attempt = 0; attempt < 2 && consentError === null; attempt += 1) {
        ({ error: consentError } = await teacher
          .from('guardian_consents')
          .upsert(consent, { onConflict: 'id', ignoreDuplicates: true }));
      }
      expect(consentError === null, `Consent was not recorded (${consentError?.message ?? ''}).`);

      // The nightly draw, run now for this class, as of today (or the 28th on the catching-up days,
      // when no new week starts). The run's learner was enrolled today; dating the enrolment to the
      // first of the month lets the draw include them on any day of it.
      expect(UUID_PATTERN.test(student.id), 'The learner has an unexpected identifier.');
      await runSql(
        `update public.enrolments set enrolled_on = date_trunc('month', private.today())::date
         where student_id = '${student.id}'::uuid;
         select private.draw_pulse_cycle('${classId}'::uuid,
           least(private.today(), date_trunc('month', private.today())::date + 27))`,
      );
      const { data: cycle, error: cycleError } = await teacher
        .from('pulse_cycles')
        .select('id, grade, language, sample_size')
        .eq('class_section_id', classId)
        .single();
      expect(cycleError === null, `The cycle could not be read (${cycleError?.message ?? ''}).`);
      expect(cycle.sample_size === 1, `The draw took ${String(cycle.sample_size)} children.`);
      const { data: samples, error: sampleError } = await teacher
        .from('pulse_samples')
        .select('id, student_id, week, due_on')
        .eq('cycle_id', cycle.id);
      expect(
        sampleError === null,
        `Drawn children could not be read (${sampleError?.message ?? ''}).`,
      );
      const [sample] = samples;
      expect(
        sample !== undefined && samples.length === 1 && sample.student_id === student.id,
        'The teacher did not see the drawn child.',
      );

      // Absences: on the catching-up days the child's week is over, so there is no day to mark.
      if (sample.due_on !== null && today <= sample.due_on) {
        const markAbsent = () =>
          teacher
            .from('pulse_absences')
            .upsert(
              { sample_id: sample.id, absent_on: today },
              { onConflict: 'sample_id,absent_on', ignoreDuplicates: true },
            );

        // Today's register, as the attendance step left it, shows the child present: an absence
        // for Pulse that contradicts it is refused.
        const { error: presentError } = await markAbsent();
        expect(
          presentError !== null && /present/i.test(presentError.message),
          `An absence the attendance register contradicts answered "${
            presentError?.message ?? 'success'
          }".`,
        );

        // Once the register shows the child absent, the absence is accepted, and can be sent
        // twice (a resend after a lost answer).
        const { data: register, error: registerError } = await teacher
          .from('attendance_sessions')
          .select('updated_at')
          .eq('class_section_id', classId)
          .eq('attendance_date', today)
          .single();
        expect(
          registerError === null,
          `Today's register could not be read (${registerError?.message ?? ''}).`,
        );
        const { data: corrected, error: correctError } = await teacher
          .from('attendance_sessions')
          .update({ absent_student_ids: [student.id] })
          .eq('class_section_id', classId)
          .eq('attendance_date', today)
          .eq('updated_at', register.updated_at)
          .select('absent_student_ids');
        expect(
          correctError === null && corrected.length === 1,
          `The register could not be corrected (${correctError?.message ?? ''}).`,
        );
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { error: absenceError } = await markAbsent();
          expect(
            absenceError === null,
            `The absence was refused (${absenceError?.message ?? ''}).`,
          );
        }
      } else {
        report.note('The absence step is skipped on the catching-up days at the end of a month.');
      }
      return {
        classId,
        cycleId: cycle.id,
        sampleId: sample.id,
        week: sample.week,
        grade: cycle.grade,
        language: cycle.language,
      };
    },
  );

  await report.check(
    'The phone can open the week the database encrypted, and only staff can read it',
    async () => {
      const { data: batch, error: batchError } = await teacher
        .from('pulse_week_batches')
        .select('week, iv, ciphertext, mac')
        .eq('cycle_id', pulse.cycleId)
        .eq('week', pulse.week ?? 0)
        .single();
      expect(
        batchError === null,
        `The teacher could not read the week (${batchError?.message ?? ''}).`,
      );
      const { data: key, error: keyError } = await teacher
        .from('pulse_week_keys')
        .select('key')
        .eq('cycle_id', pulse.cycleId)
        .eq('week', batch.week)
        .single();
      expect(
        keyError === null,
        `The teacher did not get the key of the open week (${keyError?.message ?? ''}).`,
      );

      // The same decryption the teacher's phone runs, against what the hosted database encrypted.
      const opened = await openWeek(key.key, batch);
      expect(
        opened.cycleId === pulse.cycleId &&
          opened.week === batch.week &&
          opened.children.some(
            (child) => child.sampleId === pulse.sampleId && child.studentId === student.id,
          ),
        'The opened week does not hold the drawn child.',
      );

      // The CRP holds the key too, to unlock the week on a phone that was offline.
      const { data: crpKeys, error: crpError } = await crp
        .from('pulse_week_keys')
        .select('key')
        .eq('cycle_id', pulse.cycleId);
      expect(
        crpError === null && crpKeys.some((entry) => entry.key === key.key),
        `The CRP did not get the week's key (${crpError?.message ?? ''}).`,
      );

      const { data: seen, error: visitorError } = await visitor
        .from('pulse_week_keys')
        .select('key')
        .eq('cycle_id', pulse.cycleId);
      expect(
        visitorError !== null || seen.length === 0,
        'A visitor without an account could read a week key.',
      );
    },
  );

  const recordingPath = await report.check(
    'The teacher uploads a Pulse recording and records the check',
    async () => {
      const checkId = crypto.randomUUID();
      const folder = `${pulse.classId}/${pulse.sampleId}`;
      const path = `${folder}/${checkId}.webm`;
      // Random content: the server refuses a file already sent for another check.
      const audio = new Blob([crypto.getRandomValues(new Uint8Array(2048))], {
        type: 'audio/webm',
      });
      const bucket = teacher.storage.from(PULSE_BUCKET);

      const notAudio = `${folder}/${crypto.randomUUID()}.webm`;
      const { error: typeError } = await bucket.upload(notAudio, new Blob(['text']), {
        contentType: 'text/plain',
      });
      if (!typeError) {
        run.pulseFiles.push(notAudio);
      }
      expect(typeError !== null, 'A file that is not audio was accepted.');

      const { error: uploadError } = await bucket.upload(path, audio, {
        contentType: 'audio/webm',
        upsert: false,
      });
      expect(
        uploadError === null,
        `The recording was not uploaded (${uploadError?.message ?? ''}).`,
      );
      run.pulseFiles.push(path);

      const { error: againError } = await bucket.upload(path, audio, {
        contentType: 'audio/webm',
        upsert: false,
      });
      expect(
        againError !== null && isAlreadyStored(againError),
        `A second upload of the same recording answered "${againError?.message ?? 'success'}".`,
      );

      const crpPath = `${folder}/${crypto.randomUUID()}.webm`;
      const { error: crpError } = await crp.storage
        .from(PULSE_BUCKET)
        .upload(crpPath, audio, { contentType: 'audio/webm' });
      if (!crpError) {
        run.pulseFiles.push(crpPath);
      }
      expect(crpError !== null, 'The CRP could upload a recording.');

      const { error: checkError } = await teacher.from('pulse_checks').upsert(
        {
          id: checkId,
          sample_id: pulse.sampleId,
          class_section_id: pulse.classId,
          student_id: student.id,
          mode: 'recorded',
          audio_type: 'audio/webm',
          audio_bytes: audio.size,
          attempt: 1,
          item_code: `${pulse.language}-g${String(pulse.grade)}-p01`,
          prompt_code: `en-g${String(pulse.grade)}-s01`,
          item: { kind: 'live-check' },
          audio_path: path,
          duration_ms: 58_000,
          noise_dbfs: -50,
          reading_level: 'fluent',
          english_level: 'sentences',
          clarity: 'clear',
          classroom: 'normal',
          tags: [],
          recorded_at: new Date().toISOString(),
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      expect(checkError === null, `The check was not accepted (${checkError?.message ?? ''}).`);
      const { data: saved, error: readError } = await teacher
        .from('pulse_checks')
        .select('audio_bytes, audio_type, recorded_by')
        .eq('id', checkId)
        .single();
      expect(readError === null, `The check could not be read (${readError?.message ?? ''}).`);
      expect(
        saved.audio_bytes === audio.size &&
          saved.audio_type === 'audio/webm' &&
          saved.recorded_by === staff.teacher.userId,
        'The check does not carry the size, type and teacher the server should have stamped.',
      );
      return path;
    },
  );

  await report.check('The CRP can listen to the recording and a visitor cannot', async () => {
    const { data: heard, error: crpError } = await crp.storage
      .from(PULSE_BUCKET)
      .download(recordingPath);
    expect(crpError === null && heard.size === 2048, 'The CRP could not download the recording.');
    const { error: visitorError } = await visitor.storage
      .from(PULSE_BUCKET)
      .download(recordingPath);
    expect(visitorError !== null, 'A visitor without an account could download the recording.');
  });

  await report.check(
    'The scoring engine finds the recording, and only the school sees its score',
    async () => {
      // The check's id is the file name of its recording.
      const checkId = recordingPath.split('/').at(-1)?.split('.')[0] ?? '';
      expect(UUID_PATTERN.test(checkId), 'The recording has an unexpected name.');
      const { data: waiting, error: waitingError } = await service.rpc(
        'service_pulse_checks_to_score',
        { batch_size: ENGINE_LIST_LIMIT, current_engine: `live check ${tag}` },
      );
      expect(
        waitingError === null,
        `The checks to score could not be read (${waitingError?.message ?? ''}).`,
      );
      const listed = waiting.find((row) => row.check_id === checkId);
      if (listed === undefined && waiting.length >= ENGINE_LIST_LIMIT) {
        // A new recording comes after the older ones waiting; the engine reaches it later.
        report.note(
          `More than ${String(ENGINE_LIST_LIMIT)} recordings wait for the engine; this one is further down its list.`,
        );
      } else {
        expect(
          listed?.audio_path === recordingPath && listed.reading_language === pulse.language,
          'The engine was not given the recording and its language.',
        );
      }

      // A score as the engine writes it, with the secret key.
      const { error: scoreError } = await service.from('pulse_scores').upsert(
        {
          check_id: checkId,
          class_section_id: pulse.classId,
          engine_version: `live check ${tag}`,
          reading_level: 'hesitant',
          reached_level: 'passage',
          reading_items: 30,
          reading_correct: 24,
          reading_seconds: 38,
          wcpm: 37.9,
          english_level: 'words',
          english_words: 3,
          english_seconds: 12,
          keyword_hits: 1,
          other_language_share: 0,
          confidence: 0.8,
          flags: [],
          transcript: { reading: [], english: '' },
        },
        { onConflict: 'check_id' },
      );
      expect(scoreError === null, `The score was not accepted (${scoreError?.message ?? ''}).`);

      const { data: seen, error: readError } = await teacher
        .from('pulse_scores')
        .select('reading_level, wcpm')
        .eq('check_id', checkId);
      expect(
        readError === null && seen.length === 1 && seen[0]?.reading_level === 'hesitant',
        `The teacher could not read the score (${readError?.message ?? ''}).`,
      );
      const { data: hidden, error: visitorError } = await visitor
        .from('pulse_scores')
        .select('check_id')
        .eq('check_id', checkId);
      expect(
        visitorError !== null || hidden.length === 0,
        'A visitor without an account could read a score.',
      );
      // Refused outright, or filtered by the access rules so that no row changes.
      const { data: forged, error: forgedError } = await teacher
        .from('pulse_scores')
        .update({ reading_level: 'fluent' })
        .eq('check_id', checkId)
        .select('check_id');
      expect(
        forgedError !== null || forged.length === 0,
        'A teacher could change the engine’s score.',
      );
    },
  );

  const request = await report.check(
    "A teacher's request for a visit reaches the CRP",
    async () => {
      const { data, error } = await teacher
        .from('visit_requests')
        .insert({
          class_section_id: pulse.classId,
          school_id: school.id,
          topic: 'reading',
          note: `Live check ${tag}`,
        })
        .select('id')
        .single();
      expect(error === null, `The request was refused (${error?.message ?? ''}).`);
      const { data: seen, error: readError } = await crp
        .from('visit_requests')
        .select('id')
        .eq('id', data.id);
      expect(readError === null && seen.length === 1, 'The CRP could not see the request.');
      return data.id;
    },
  );

  const visit = await report.check(
    'The CRP plans and records a visit, which the teacher reads and a visitor cannot',
    async () => {
      const id = crypto.randomUUID();
      const moment = crypto.randomUUID();
      const save = async (body: Record<string, unknown>) => {
        const { data, error } = await crp.rpc('save_visit', {
          visit: { id, change_id: crypto.randomUUID(), class_section_id: pulse.classId, ...body },
        });
        expect(error === null, `The visit was refused (${error?.message ?? ''}).`);
        return data;
      };
      const planned = await save({
        status: 'planned',
        planned_on: today,
        observations: [{ item_code: 'every-child-reads', position: 1, answer: null }],
      });
      expect(planned === 1, `The planned visit was saved as revision ${String(planned)}.`);
      const checkBack = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const done = await save({
        base_revision: planned,
        status: 'done',
        teacher_id: staff.teacher.userId,
        visited_on: today,
        started_at: new Date(Date.now() - 40 * 60_000).toISOString(),
        finished_at: new Date().toISOString(),
        request_id: request,
        observations: [{ item_code: 'every-child-reads', position: 1, answer: 'yes' }],
        moments: [{ id: moment, tag_code: 'all-reading', at_seconds: 600 }],
        feedback: {
          strength: `Live check ${tag}: every child read a line alone.`,
          evidence: [{ moment }],
          practice_code: 'paired-reading',
          check_back_on: checkBack,
          agreed_at: new Date().toISOString(),
        },
      });
      expect(done === 2, `The visit was saved as revision ${String(done)}.`);

      const { data: answered, error: requestError } = await crp
        .from('visit_requests')
        .select('answered_by_visit_id')
        .eq('id', request)
        .single();
      expect(
        requestError === null && answered.answered_by_visit_id === id,
        'The visit did not answer the open request.',
      );
      const { data: read, error: readError } = await teacher
        .from('visits')
        .select('id, visit_feedback(strength), visit_moments(tag_code)')
        .eq('id', id)
        .single();
      expect(
        readError === null && read.visit_feedback?.strength.startsWith('Live check') === true,
        `The teacher could not read the visit (${readError?.message ?? ''}).`,
      );
      const { data: hidden, error: visitorError } = await visitor
        .from('visits')
        .select('id')
        .eq('id', id);
      expect(visitorError !== null || hidden.length === 0, 'A visitor could read the visit.');
      const { error: forgedError } = await teacher.rpc('save_visit', {
        visit: { id, change_id: crypto.randomUUID(), base_revision: done, status: 'done' },
      });
      expect(forgedError !== null, 'A teacher could change the visit.');
      return id;
    },
  );

  await report.check("The week's plan ranks the class with its check-back", async () => {
    const { data, error } = await crp.rpc('crp_class_signal');
    expect(error === null, `crp_class_signal failed: ${error?.message ?? ''}`);
    const row = data.find((entry) => entry.class_section_id === pulse.classId);
    expect(row !== undefined, 'The class is missing from the plan.');
    expect(row.check_back_visit_id === visit, 'The agreed step is not waiting for its check-back.');
    expect(row.last_visit_on === today, 'The visit is not counted as the last one.');
  });

  await report.check('The CRP reviews a recording, which the teacher sees', async () => {
    const checkId = recordingPath.split('/').at(-1)?.split('.')[0] ?? '';
    const { error } = await crp.from('pulse_reviews').upsert(
      {
        check_id: checkId,
        class_section_id: pulse.classId,
        reading_level: 'hesitant',
        english_level: 'words',
      },
      { onConflict: 'check_id' },
    );
    expect(error === null, `The review was refused (${error?.message ?? ''}).`);
    const { data, error: readError } = await teacher
      .from('pulse_reviews')
      .select('reading_level')
      .eq('check_id', checkId);
    expect(
      readError === null && data.length === 1 && data[0]?.reading_level === 'hesitant',
      'The teacher could not see the review.',
    );
    // A teacher may read the review but has no rule allowing a change: the update reaches no row,
    // which the database reports as an empty result rather than an error.
    const { data: forged, error: forgedError } = await teacher
      .from('pulse_reviews')
      .update({ reading_level: 'fluent' })
      .eq('check_id', checkId)
      .select('check_id');
    expect(forgedError !== null || forged.length === 0, 'A teacher could change the review.');
    const { data: kept, error: keptError } = await crp
      .from('pulse_reviews')
      .select('reading_level')
      .eq('check_id', checkId)
      .single();
    expect(
      keptError === null && kept.reading_level === 'hesitant',
      'The review changed after a teacher tried to change it.',
    );
  });

  await report.check("The CRP's tasks stay within the cluster", async () => {
    const id = crypto.randomUUID();
    const { error } = await crp.from('crp_tasks').insert({
      id,
      cluster_id: school.clusterId,
      school_id: school.id,
      title: `Live check ${tag} task`,
      source: 'order',
      due_on: today,
    });
    expect(error === null, `The task was refused (${error?.message ?? ''}).`);
    const { data, error: readError } = await teacher.from('crp_tasks').select('id').eq('id', id);
    expect(readError !== null || data.length === 0, 'A teacher could read a task of the CRP.');
  });

  await report.check('A voice note reaches only the CRP, and the engine lists it', async () => {
    const noteId = crypto.randomUUID();
    const path = `${visit}/${noteId}.webm`;
    const audio = crypto.getRandomValues(new Uint8Array(2048));
    const { error: uploadError } = await crp.storage
      .from(NOTES_BUCKET)
      .upload(path, new Blob([audio], { type: 'audio/webm' }), { contentType: 'audio/webm' });
    expect(
      uploadError === null || isAlreadyStored(uploadError),
      `The voice note could not be uploaded (${uploadError?.message ?? ''}).`,
    );
    run.noteFiles.push(path);
    const { error } = await crp.from('visit_notes').upsert(
      {
        visit_id: visit,
        note_id: noteId,
        audio_path: path,
        audio_type: 'audio/webm',
        audio_bytes: audio.length,
        duration_ms: 30_000,
        language: 'hi',
        recorded_at: new Date().toISOString(),
      },
      { onConflict: 'visit_id' },
    );
    expect(error === null, `The note was refused (${error?.message ?? ''}).`);
    const { data: teacherNotes, error: teacherError } = await teacher
      .from('visit_notes')
      .select('visit_id')
      .eq('visit_id', visit);
    expect(
      teacherError !== null || teacherNotes.length === 0,
      'A teacher could read the CRP’s voice note.',
    );
    const { error: listenError } = await teacher.storage.from(NOTES_BUCKET).download(path);
    expect(listenError !== null, 'A teacher could listen to the CRP’s voice note.');
    const { data: waiting, error: listError } = await service.rpc(
      'service_visit_notes_to_transcribe',
      { batch_size: ENGINE_LIST_LIMIT },
    );
    expect(listError === null, `The engine's list failed: ${listError?.message ?? ''}`);
    const listed = waiting.some((row) => row.visit_id === visit && row.audio_path === path);
    if (!listed && waiting.length >= ENGINE_LIST_LIMIT) {
      report.note(
        `More than ${String(ENGINE_LIST_LIMIT)} voice notes wait for the engine; this one is further down its list.`,
      );
    } else {
      expect(listed, 'The engine was not given the voice note.');
    }
  });

  const examPaper = await report.check(
    'The CRP schedules an exam for the cluster, which the school sees and a visitor does not',
    async () => {
      const paperId = crypto.randomUUID();
      const exam = {
        id: crypto.randomUUID(),
        academic_year_id: academicYearId,
        kind: 'unit_test',
        title: `Live check ${tag}`,
        cluster_id: school.clusterId,
        school_id: null,
        starts_on: today,
        ends_on: today,
        papers: [
          {
            id: paperId,
            class_section_id: pulse.classId,
            subject: 'hindi',
            held_on: today,
            scale: 'marks',
            max_marks: 20,
          },
        ],
      };
      // Sent twice, as a phone does when the first answer is lost: the second changes nothing.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await crp.rpc('save_exam', { exam });
        expect(error === null, `The exam was refused (${error?.message ?? ''}).`);
      }
      const { data: seen, error: seenError } = await teacher
        .from('exam_papers')
        .select('id')
        .eq('id', paperId);
      expect(seenError === null && seen.length === 1, 'The teacher could not see the paper.');
      const { data: hidden, error: hiddenError } = await visitor
        .from('exam_papers')
        .select('id')
        .eq('id', paperId);
      expect(hiddenError !== null || hidden.length === 0, 'A visitor could see the paper.');
      const { error: forgedError } = await teacher.rpc('save_exam', {
        exam: { ...exam, title: 'Changed by a teacher' },
      });
      expect(forgedError !== null, 'A teacher could change the CRP’s exam.');
      return { paperId, examId: exam.id };
    },
  );

  await report.check(
    'The teacher enters marks, which the CRP reads beside Pulse and a visitor cannot',
    async () => {
      const changeId = crypto.randomUUID();
      const save = () =>
        teacher.rpc('save_exam_marks', {
          paper_marks: {
            paper_id: examPaper.paperId,
            change_id: changeId,
            base_revision: 0,
            supersedes: [],
            entries: [{ student_id: student.id, marks: 18 }],
          },
        });
      const first = await save();
      expect(
        first.error === null && first.data === 1,
        `The marks were refused (${first.error?.message ?? ''}).`,
      );
      const again = await save();
      expect(again.error === null && again.data === 1, 'A resent save was applied twice.');
      const { error: crpError } = await crp.rpc('save_exam_marks', {
        paper_marks: {
          paper_id: examPaper.paperId,
          change_id: crypto.randomUUID(),
          base_revision: 1,
          supersedes: [],
          entries: [],
        },
      });
      expect(crpError !== null, 'A CRP could enter marks.');
      const { data: read, error: readError } = await crp
        .from('exam_marks')
        .select('marks')
        .eq('paper_id', examPaper.paperId);
      expect(
        readError === null && read.length === 1 && Number(read[0]?.marks) === 18,
        `The CRP could not read the marks (${readError?.message ?? ''}).`,
      );
      const { data: hidden, error: hiddenError } = await visitor
        .from('exam_marks')
        .select('student_id')
        .eq('paper_id', examPaper.paperId);
      expect(hiddenError !== null || hidden.length === 0, 'A visitor could read the marks.');
      const { error: pulseError } = await crp.rpc('exam_marks_pulse', {
        target_paper_id: examPaper.paperId,
      });
      expect(pulseError === null, `Marks beside Pulse failed: ${pulseError?.message ?? ''}`);
      const { data: signal, error: signalError } = await crp.rpc('crp_class_signal');
      expect(
        signalError === null &&
          signal.some((row) => row.class_section_id === pulse.classId && row.marks_to_discuss >= 0),
        `The week's plan failed: ${signalError?.message ?? ''}`,
      );
    },
  );

  await report.check(
    'Progress shows the school its children, and offices only totals over many classes',
    async () => {
      const { data: classView, error: classError } = await teacher.rpc('class_progress', {
        target_class_section_id: pulse.classId,
      });
      expect(classError === null, `class_progress failed: ${classError?.message ?? ''}`);
      const children = asRecord(classView, 'class_progress').children;
      expect(
        Array.isArray(children) &&
          children.some((child) => asRecord(child, 'child').student_id === student.id),
        "The class's progress does not list its learner.",
      );
      const { data: childView, error: childError } = await crp.rpc('child_progress', {
        target_student_id: student.id,
      });
      expect(childError === null, `child_progress failed: ${childError?.message ?? ''}`);
      const checks = asRecord(childView, 'child_progress').pulse;
      expect(
        Array.isArray(checks) && checks.length >= 1,
        "The CRP does not see the learner's Pulse check in their progress.",
      );
      const { data: hidden } = await visitor.rpc('child_progress', {
        target_student_id: student.id,
      });
      expect(hidden === null, "A visitor could see a child's progress.");

      const { data: area, error: areaError } = await administrator.rpc('area_report', {
        month_count: 3,
      });
      expect(areaError === null, `area_report failed: ${areaError?.message ?? ''}`);
      const body = asRecord(area, 'area_report');
      expect(
        body.fewest_classes === 5 && body.fewest_schools === 3 && body.fewest_crps === 2,
        'The office report does not hold back small groups.',
      );
      // The run's single class is far below five: none of its figures may appear.
      const text = JSON.stringify(body);
      expect(
        !text.includes(pulse.classId) && !text.includes(student.id),
        'The office report names a class or a child.',
      );
      const { data: forTeacher } = await teacher.rpc('area_report', { month_count: 3 });
      expect(forTeacher === null, 'A teacher received the office report.');
    },
  );

  await report.check('Sahayak answers CRPs only, within their allowance', async () => {
    const refused = await invoke(visitor, 'sahayak', { action: 'rehearse', language: 'en' });
    expect(refused.status === 401, `sahayak answered ${answered(refused)} without a sign-in.`);
    const teacherCall = await invoke(teacher, 'sahayak', { action: 'rehearse', language: 'en' });
    expect(teacherCall.status === 403, `sahayak answered ${answered(teacherCall)} for a teacher.`);
    // A visit that is not the CRP's is never scored, and costs no request.
    const missing = await invoke(crp, 'sahayak', {
      action: 'score_feedback',
      language: 'en',
      visit_id: crypto.randomUUID(),
    });
    if (missing.status === 503 && errorCodeOf(missing) === 'not_configured') {
      report.note('Sahayak is not set up yet: run `npm run ai:keys` (setup guide, Part 10).');
      return;
    }
    expect(missing.status === 404, `score_feedback answered ${answered(missing)} for no visit.`);

    const momentId = crypto.randomUUID();
    const draft = await invokeAi(crp, 'sahayak', {
      action: 'draft_feedback',
      language: 'en',
      visit: {
        // The function takes the class's names out again, so it must know the class.
        class_section_id: pulse.classId,
        teacher_id: staff.teacher.userId,
        grade: 1,
        lesson: 'Hindi, page 12',
        focus: [
          { code: 'every-child-reads', text: 'Every child reads aloud', answer: 'no', note: null },
        ],
        moments: [
          {
            id: momentId,
            tag: 'Effort praised',
            tone: 'strength',
            minute: 5,
            note: 'The teacher praised a child who tried a hard word',
          },
        ],
        pulse: null,
        follow_up: null,
        transcript: null,
        practices: [
          { code: 'paired-reading', title: 'Paired reading', why: 'Every child reads every day.' },
          { code: 'echo-reading', title: 'Echo reading', why: 'Children copy fluent reading.' },
        ],
      },
    });
    expect(draft.status === 200, `draft_feedback answered ${answered(draft)}.`);
    const drafted = asRecord(draft.body.draft, 'draft');
    expect(
      typeof drafted.strength === 'string' &&
        ['paired-reading', 'echo-reading'].includes(String(drafted.practice_code)),
      'The draft did not choose a practice of the library.',
    );

    const turn = await invokeAi(crp, 'sahayak', {
      action: 'rehearse',
      language: 'en',
      scenario: 'tired-veteran',
      messages: [
        { role: 'teacher', text: 'Half of them do not even come every day.' },
        { role: 'crp', text: 'That is hard. What helps the children who do come?' },
      ],
    });
    expect(
      turn.status === 200 && typeof turn.body.reply === 'string' && turn.body.reply !== '',
      `rehearse answered ${answered(turn)}.`,
    );
    if (turn.body.provider !== 'claude') {
      report.note(
        'The rehearsal room answered with Groq: no Claude key is stored, or its credit is used up.',
      );
    }

    // The debrief, by Claude while its credit lasts, and kept for the CRP.
    const debriefed = await invokeAi(crp, 'sahayak', {
      action: 'debrief',
      language: 'en',
      scenario: 'tired-veteran',
      messages: [
        { role: 'teacher', text: 'Half of them do not even come every day.' },
        { role: 'crp', text: 'That is hard. What helps the children who do come?' },
        { role: 'teacher', text: 'Stories, maybe. They listen to stories.' },
        {
          role: 'crp',
          text: 'Shall we try paired reading with the story, and look again on Monday?',
        },
      ],
    });
    expect(debriefed.status === 200, `debrief answered ${answered(debriefed)}.`);
    const { data: kept, error: keptError } = await crp.from('rehearsal_debriefs').select('id');
    expect(
      keptError === null && kept.length === 1,
      `The CRP does not see exactly their debrief (${keptError?.message ?? ''}).`,
    );
    const { data: hiddenDebriefs } = await teacher.from('rehearsal_debriefs').select('id');
    expect((hiddenDebriefs ?? []).length === 0, "A teacher could read the CRP's debrief.");

    // A photo without an order: it is read, and no task is invented.
    const order = await invokeAi(crp, 'sahayak', {
      action: 'read_order',
      language: 'en',
      media_type: 'image/png',
      image: BLANK_PNG,
    });
    expect(order.status === 200, `read_order answered ${answered(order)}.`);
    expect(
      order.body.readable === false &&
        Array.isArray(order.body.tasks) &&
        order.body.tasks.length === 0,
      'Tasks were read from a blank picture.',
    );
  });

  await report.check('A phone keeps notifications for its own account only', async () => {
    // An address of a real push service, which the database requires; nothing is sent to it.
    const endpoint = `https://fcm.googleapis.com/fcm/send/live-check-${tag.toLowerCase()}`;
    const { error } = await crp.rpc('keep_push_subscription', {
      endpoint,
      p256dh: `B${'x'.repeat(86)}`,
      auth_secret: 'a'.repeat(22),
    });
    expect(error === null, `The subscription was refused (${error?.message ?? ''}).`);
    const { data: own } = await crp.from('push_subscriptions').select('endpoint');
    expect(own?.length === 1, 'The CRP does not see exactly their own subscription.');
    const { data: others } = await teacher.from('push_subscriptions').select('endpoint');
    expect(others?.length === 0, "A teacher could see another account's subscription.");
    const refused = await invoke(visitor, 'notify', { kind: 'daily' });
    expect(refused.status === 403, `notify answered ${answered(refused)} without its token.`);
    const key = await invoke(visitor, 'notify', { action: 'public_key' });
    if (key.status === 503) {
      report.note(
        'Notifications are not set up yet: run `npm run push:keys` (setup guide, Part 7).',
      );
    } else {
      expect(
        key.status === 200 && typeof key.body.publicKey === 'string',
        `notify answered ${answered(key)} for the public key.`,
      );
    }
  });

  await report.check('The retention job refuses callers without its token', async () => {
    const result = await invoke(visitor, 'pulse-retention', {});
    expect(result.status === 403, `pulse-retention answered ${answered(result)}.`);
  });

  const slip = await report.check('The teacher issues a family sign-in slip', async () => {
    const result = await invoke(teacher, 'account-admin', {
      action: 'issue_family_login',
      student_id: student.id,
    });
    expect(result.status === 200, `issue_family_login answered ${answered(result)}.`);
    const learnerCode = result.body.learner_code;
    const pin = result.body.pin;
    expect(learnerCode === student.student_code, 'The slip shows a different learner code.');
    expect(typeof pin === 'string' && /^[0-9]{6}$/.test(pin), 'The slip has no six-digit PIN.');
    const { data } = await service
      .from('students')
      .select('auth_user_id')
      .eq('id', student.id)
      .single();
    if (data?.auth_user_id) {
      run.userIds.push(data.auth_user_id);
    }
    expect(
      await familySignInShownBy(teacher, student.id),
      'The console does not show the family sign-in as issued.',
    );
    return { learnerCode, pin };
  });

  await report.check('A wrong PIN is refused', async () => {
    const result = await invoke(visitor, 'family-sign-in', {
      learner_code: slip.learnerCode,
      pin: differentPin(slip.pin),
    });
    expect(
      result.status === 401 && errorCodeOf(result) === 'invalid_credentials',
      `family-sign-in answered ${answered(result)}.`,
    );
  });

  const family = await report.check(
    'The family signs in with the learner code and PIN',
    async () => {
      const client = newClient(environment.publishableKey);
      const result = await invoke(client, 'family-sign-in', {
        learner_code: slip.learnerCode,
        pin: slip.pin,
      });
      const tokenHash = result.body.token_hash;
      expect(
        result.status === 200 && typeof tokenHash === 'string',
        `family-sign-in answered ${answered(result)}.`,
      );
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
      expect(
        error === null && data.session !== null,
        `The one-time token was refused (${error?.message ?? 'no session'}).`,
      );
      const access = await accessOf(client);
      expect(
        asRecord(access.student, 'my_access student').id === student.id,
        'The family account is linked to a different learner.',
      );
      const { data: rows, error: readError } = await client.from('students').select('id');
      expect(readError === null, `The family could not read (${readError?.message ?? ''}).`);
      expect(
        rows.length === 1 && rows[0]?.id === student.id,
        `The family could read ${rows.length} learners instead of exactly their own.`,
      );
      return client;
    },
  );

  await report.check(
    "The family sees only their child's shared marks and attendance, and the class's notes",
    async () => {
      const marksOfFamily = async () => {
        const { data, error } = await family.from('exam_marks').select('student_id, marks');
        expect(error === null, `The family could not read marks (${error?.message ?? ''}).`);
        return data;
      };
      expect((await marksOfFamily()).length === 0, 'The family saw marks before they were shared.');

      // Shared twice, as a phone does when the first answer is lost.
      const shareRow = {
        exam_id: examPaper.examId,
        class_section_id: pulse.classId,
        school_id: school.id,
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await teacher
          .from('exam_result_shares')
          .upsert(shareRow, { onConflict: 'exam_id,class_section_id', ignoreDuplicates: true });
        expect(error === null, `The result could not be shared (${error?.message ?? ''}).`);
      }
      const { error: forgedShare } = await family
        .from('exam_result_shares')
        .upsert(shareRow, { onConflict: 'exam_id,class_section_id', ignoreDuplicates: true });
      expect(forgedShare !== null, 'A family could share a result.');
      const shared = await marksOfFamily();
      expect(
        shared.length === 1 &&
          shared[0]?.student_id === student.id &&
          Number(shared[0].marks) === 18,
        `The family saw ${String(shared.length)} marks instead of their child's one.`,
      );

      // The child's own day, as today's register holds it.
      const { data: register, error: registerError } = await service
        .from('attendance_sessions')
        .select('absent_student_ids')
        .eq('class_section_id', pulse.classId)
        .eq('attendance_date', today)
        .maybeSingle();
      expect(
        registerError === null,
        `The register could not be read (${registerError?.message ?? ''}).`,
      );
      const { data: days, error: daysError } = await family.rpc('my_attendance', { since: today });
      expect(daysError === null, `my_attendance failed: ${daysError?.message ?? ''}`);
      if (register) {
        const present = !register.absent_student_ids.includes(student.id);
        expect(
          days.length === 1 && days[0]?.attendance_date === today && days[0].present === present,
          "The family's attendance does not match the register.",
        );
      } else {
        expect(days.length === 0, 'The family saw a day without a register.');
      }
      const { data: classRegister } = await family.from('attendance_sessions').select('id');
      expect((classRegister ?? []).length === 0, "A family could read the class's register.");

      // A note with a PDF, sent twice as a phone does.
      const noteId = crypto.randomUUID();
      const path = `${pulse.classId}/${noteId}.pdf`;
      const pdf = new Blob(['%PDF-1.4\n% Live check\n'], { type: 'application/pdf' });
      const { error: uploadError } = await teacher.storage
        .from(CLASS_NOTES_BUCKET)
        .upload(path, pdf, { contentType: 'application/pdf', upsert: false });
      expect(uploadError === null, `The note's file was refused (${uploadError?.message ?? ''}).`);
      const note = {
        id: noteId,
        class_section_id: pulse.classId,
        school_id: school.id,
        kind: 'homework',
        body: `Live check ${tag}: read page 4 at home.`,
        due_on: today,
        attachment_path: path,
        attachment_type: 'application/pdf',
        attachment_bytes: pdf.size,
        attachment_name: 'Page 4.pdf',
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await teacher
          .from('class_notes')
          .upsert(note, { onConflict: 'id', ignoreDuplicates: true });
        expect(error === null, `The note was refused (${error?.message ?? ''}).`);
      }
      const { data: notes, error: notesError } = await family
        .from('class_notes')
        .select('id, author_name, attachment_bytes');
      expect(
        notesError === null,
        `The family could not read notes (${notesError?.message ?? ''}).`,
      );
      expect(
        notes.length === 1 && notes[0]?.id === noteId && notes[0].attachment_bytes === pdf.size,
        `The family saw ${String(notes.length)} notes instead of the one sent.`,
      );
      const { error: openError } = await family.storage.from(CLASS_NOTES_BUCKET).download(path);
      expect(
        openError === null,
        `The family could not open the file (${openError?.message ?? ''}).`,
      );
      const { data: hiddenNotes } = await visitor.from('class_notes').select('id');
      expect((hiddenNotes ?? []).length === 0, 'A visitor could read the notes.');
      const { error: visitorOpen } = await visitor.storage.from(CLASS_NOTES_BUCKET).download(path);
      expect(visitorOpen !== null, "A visitor could open the note's file.");
      const { error: familyNote } = await family
        .from('class_notes')
        .insert({ ...note, id: crypto.randomUUID(), attachment_path: null });
      expect(familyNote !== null, 'A family could send a note to the class.');

      // Removed by the teacher, with its file; and the result taken back.
      const { error: removeError } = await teacher.from('class_notes').delete().eq('id', noteId);
      expect(
        removeError === null,
        `The note could not be removed (${removeError?.message ?? ''}).`,
      );
      const { data: removed, error: fileError } = await teacher.storage
        .from(CLASS_NOTES_BUCKET)
        .remove([path]);
      expect(
        fileError === null && removed.length === 1,
        `The note's file could not be removed (${fileError?.message ?? ''}).`,
      );
      const { data: afterRemoval } = await family.from('class_notes').select('id');
      expect((afterRemoval ?? []).length === 0, 'The family still saw the removed note.');
      const { error: unshareError } = await teacher
        .from('exam_result_shares')
        .delete()
        .eq('exam_id', examPaper.examId)
        .eq('class_section_id', pulse.classId);
      expect(
        unshareError === null,
        `Sharing could not be stopped (${unshareError?.message ?? ''}).`,
      );
      expect((await marksOfFamily()).length === 0, 'The family still saw marks no longer shared.');
    },
  );

  const resetPassword = await report.check("The CRP resets the teacher's password", async () => {
    const result = await invoke(crp, 'account-admin', {
      action: 'reset_staff_password',
      user_id: staff.teacher.userId,
    });
    expect(result.status === 200, `reset_staff_password answered ${answered(result)}.`);
    const temporaryPassword = result.body.temporary_password;
    expect(typeof temporaryPassword === 'string', 'No temporary password was returned.');
    const refusal = await refusalOf(staff.teacher.email, teacherPassword);
    expect(refusal === 'invalid_credentials', `The previous password was refused as "${refusal}".`);
    const client = await signIn(staff.teacher.email, temporaryPassword);
    expect(
      (await accessOf(client)).password_change_required === true,
      'The reset account was not marked for a change.',
    );
    return temporaryPassword;
  });

  await report.check("Withdrawing the family sign-in ends the family's access", async () => {
    const result = await invoke(crp, 'account-admin', {
      action: 'revoke_family_login',
      student_id: student.id,
    });
    expect(result.status === 200, `revoke_family_login answered ${answered(result)}.`);
    expect(
      !(await familySignInShownBy(crp, student.id)),
      'The console still shows the withdrawn family sign-in as issued.',
    );
    // The family's existing session stays technically valid until it expires; what matters is
    // that it no longer reaches any data.
    const { data: rows, error } = await family.from('students').select('id');
    expect(
      error !== null || rows.length === 0,
      'The signed-in family could still read the learner.',
    );
    const again = await invoke(visitor, 'family-sign-in', {
      learner_code: slip.learnerCode,
      pin: slip.pin,
    });
    expect(again.status === 401, `Signing in with the withdrawn PIN answered ${answered(again)}.`);
  });

  await report.check(
    'A visitor opens a demonstration district of their own and switches roles',
    async () => {
      const client = newClient(environment.publishableKey);
      const started = await invoke(client, 'demo', {
        action: 'start',
        role: 'teacher',
        language: 'en',
      });
      expect(
        errorCodeOf(started) !== 'not_configured',
        'The demo is switched off: set the DEMO_ENABLED secret (see the setup guide).',
      );
      const tokenHash = started.body.token_hash;
      expect(
        started.status === 200 && typeof tokenHash === 'string',
        `demo answered ${answered(started)}.`,
      );
      const { data: signedIn, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'email',
      });
      expect(
        error === null && signedIn.user !== null,
        `The demo token was refused (${error?.message ?? ''}).`,
      );
      const visitorId = signedIn.user.id;
      const sandbox = await service.rpc('service_demo_sandbox_of', { target_user_id: visitorId });
      try {
        const { data: demo } = await client.rpc('my_demo');
        expect(
          asRecord(demo, 'my_demo').role === 'teacher',
          'The visitor is not the teacher of the district.',
        );
        const { data: children, error: childError } = await client
          .from('students')
          .select('id, school_id');
        expect(
          childError === null,
          `The demo teacher could not read (${childError?.message ?? ''}).`,
        );
        expect(
          children.length >= 30 && new Set(children.map((child) => child.school_id)).size === 1,
          `The demo teacher sees ${children.length} children instead of one school's.`,
        );
        // The run's CRP is still signed in here (the teacher's session ended with the reset).
        const { data: fromReal, error: realError } = await crp
          .from('students')
          .select('id')
          .eq('school_id', children[0]?.school_id ?? '');
        expect(realError === null, `The CRP could not read (${realError?.message ?? ''}).`);
        expect(fromReal.length === 0, "A real CRP could see a demonstration school's children.");

        const switched = await invoke(client, 'demo', { action: 'switch', role: 'officer' });
        expect(
          switched.status === 200 && typeof switched.body.token_hash === 'string',
          `Switching roles answered ${answered(switched)}.`,
        );
        const officer = newClient(environment.publishableKey);
        const { error: officerError } = await officer.auth.verifyOtp({
          token_hash: switched.body.token_hash,
          type: 'email',
        });
        expect(
          officerError === null,
          `The officer's token was refused (${officerError?.message ?? ''}).`,
        );
        const { data: area } = await officer.rpc('area_report', { month_count: 6 });
        const body = asRecord(area, 'area_report');
        expect(
          body.schools === 16,
          `The demo officer's area has ${String(body.schools)} schools instead of 16.`,
        );
        const shown = Array.isArray(body.pulse)
          ? body.pulse.filter((row: unknown) => asRecord(row, 'pulse').withheld === false)
          : [];
        expect(shown.length > 0, "The demo officer's report shows no Pulse figures.");
        // The function checks the session with the Auth service, so a session the run's password
        // resets have ended is turned away as signed out (401); a live one as not a visitor (403).
        const outsider = await invoke(crp, 'demo', { action: 'switch', role: 'crp' });
        expect(
          (outsider.status === 401 || outsider.status === 403) &&
            outsider.body.token_hash === undefined,
          `A real CRP switching into a demo answered ${answered(outsider)}.`,
        );
      } finally {
        // The hourly sweep removes it with its accounts.
        if (typeof sandbox.data === 'string') {
          await service.rpc('service_demo_expire', { target_sandbox: sandbox.data });
        }
      }
    },
  );

  await report.check('A deactivated teacher can no longer sign in', async () => {
    const result = await invoke(administrator, 'account-admin', {
      action: 'set_staff_active',
      user_id: staff.teacher.userId,
      active: false,
    });
    expect(result.status === 200, `set_staff_active answered ${answered(result)}.`);
    const refusal = await refusalOf(staff.teacher.email, resetPassword);
    expect(refusal === 'user_banned', `Sign-in was refused as "${refusal}" instead of banned.`);
  });
}
