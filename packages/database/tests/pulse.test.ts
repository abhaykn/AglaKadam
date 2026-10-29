import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, errorCodeOf, type TestDatabase } from './support/database';
import { openWeek, WeekKeyError } from '../../../apps/web/src/features/pulse/week-batch';
import { asUser, createScenario, insertStudent, type Scenario } from './support/scenario';

/** The value, or a failed test when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error('Expected a value, but there was none.');
  }
  return value;
}

let database: TestDatabase;
let scenario: Scenario;

beforeAll(async () => {
  database = await createTestDatabase();
  scenario = await createScenario(database);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.begin();
});

afterEach(async () => {
  await database.rollback();
});

let sectionCounter = 0;

/** A new class of school A1 with `count` children who may all be drawn. */
async function classWithChildren(
  count: number,
  options: { grade?: number; medium?: 'hi' | 'en'; schoolId?: string } = {},
): Promise<{ classId: string; children: string[] }> {
  sectionCounter += 1;
  const [row] = await database.query<{ id: string }>(
    `insert into public.class_sections (school_id, academic_year_id, grade, section, medium)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      options.schoolId ?? scenario.schoolA1Id,
      scenario.academicYearId,
      options.grade ?? 2,
      `P${String(sectionCounter)}`,
      options.medium ?? 'hi',
    ],
  );
  const classId = must(row).id;
  const children: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const studentId = await insertStudent(database.query, {
      schoolId: options.schoolId ?? scenario.schoolA1Id,
      fullName: `Pulse Learner ${String(index + 1)}`,
      classSectionId: classId,
    });
    await grantConsent(studentId);
    children.push(studentId);
  }
  return { classId, children };
}

async function grantConsent(studentId: string, granted = true): Promise<void> {
  await database.query(
    // Strictly later than any earlier decision, so the newest one is never ambiguous.
    `insert into public.guardian_consents (student_id, purpose, granted, guardian_name, method, recorded_at)
     values ($1, 'audio_assessment', $2, 'Guardian', 'paper_form', greatest(
       clock_timestamp(),
       coalesce((select max(recorded_at) from public.guardian_consents where student_id = $1), '-infinity') + interval '1 millisecond'
     ))`,
    [studentId, granted],
  );
}

/** First day of the current month in India, plus `days`. */
async function dayOfMonth(days = 0): Promise<string> {
  const [row] = await database.query<{ day: string }>(
    `select (date_trunc('month', private.today())::date + $1::int)::text as day`,
    [days],
  );
  return must(row).day;
}

async function draw(classId: string, onDate: string): Promise<string | null> {
  const [row] = await database.query<{ id: string | null }>(
    'select private.draw_pulse_cycle($1, $2::date) as id',
    [classId, onDate],
  );
  return must(row).id;
}

interface SampleRow {
  id: string;
  student_id: string;
  draw_position: number;
  week: number | null;
  opens_on: string | null;
  due_on: string | null;
  replaces_sample_id: string | null;
  replaced_at: string | null;
  replacement_reason: string | null;
}

async function samplesOf(cycleId: string): Promise<SampleRow[]> {
  return database.query<SampleRow>(
    `select id, student_id, draw_position, week, opens_on::text, due_on::text, replaces_sample_id,
       replaced_at::text, replacement_reason
     from public.pulse_samples where cycle_id = $1 order by draw_position`,
    [cycleId],
  );
}

describe('the monthly draw', () => {
  it('draws 20 children over four weeks of five, and keeps up to 10 in a hidden reserve', async () => {
    const { classId, children } = await classWithChildren(32);
    const cycleId = await draw(classId, await dayOfMonth());

    const [cycle] = await database.query(
      `select eligible_count, sample_size, reserve_size, first_week, grade, language
       from public.pulse_cycles where id = $1`,
      [cycleId],
    );
    expect(cycle).toMatchObject({
      eligible_count: 32,
      sample_size: 20,
      reserve_size: 10,
      first_week: 1,
      grade: 2,
      language: 'hi',
    });

    const samples = await samplesOf(must(cycleId));
    expect(samples).toHaveLength(30);
    const weeks = samples.map((sample) => sample.week);
    expect(weeks.slice(0, 20)).toEqual([
      ...Array<number>(5).fill(1),
      ...Array<number>(5).fill(2),
      ...Array<number>(5).fill(3),
      ...Array<number>(5).fill(4),
    ]);
    expect(weeks.slice(20).every((week) => week === null)).toBe(true);
    expect(new Set(samples.map((sample) => sample.student_id)).size).toBe(30);
    expect(samples.every((sample) => children.includes(sample.student_id))).toBe(true);

    const monthStart = await dayOfMonth();
    expect(samples[0]).toMatchObject({ opens_on: monthStart, due_on: await dayOfMonth(6) });
    expect(samples[19]).toMatchObject({
      opens_on: await dayOfMonth(21),
      due_on: await dayOfMonth(27),
    });
  });

  it('can be repeated by anyone with the seed and the list of eligible children', async () => {
    const { classId } = await classWithChildren(12);
    const cycleId = await draw(classId, await dayOfMonth());

    const [repeated] = await database.query<{ matches: boolean }>(
      `select array_agg(s.student_id order by s.draw_position)
         = (select (array_agg(id order by extensions.digest(d.seed || ':' || id::text, 'sha256')))[1:12]
            from unnest(d.eligible_student_ids) as id) as matches
       from public.pulse_samples as s
       join private.pulse_draws as d on d.cycle_id = s.cycle_id
       where s.cycle_id = $1
       group by d.seed, d.eligible_student_ids`,
      [cycleId],
    );
    expect(repeated?.matches).toBe(true);
  });

  it('draws once a month: a second call returns the same cycle', async () => {
    const { classId } = await classWithChildren(8);
    const first = await draw(classId, await dayOfMonth());
    const second = await draw(classId, await dayOfMonth(3));
    expect(second).toBe(first);
    const [count] = await database.query<{ count: number }>(
      'select count(*)::int as count from public.pulse_samples where class_section_id = $1',
      [classId],
    );
    expect(count?.count).toBe(8);
  });

  it('draws verified children with consent, and children with special needs for the adapted check', async () => {
    const { classId, children } = await classWithChildren(3);
    const pending = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Not Verified',
      status: 'pending',
      classSectionId: classId,
    });
    await grantConsent(pending);
    const withoutConsent = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'No Consent',
      classSectionId: classId,
    });
    const withdrawn = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Consent Withdrawn',
      classSectionId: classId,
    });
    await grantConsent(withdrawn);
    await grantConsent(withdrawn, false);
    const specialNeeds = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Adapted Check',
      classSectionId: classId,
    });
    // No audio consent: the adapted check records nothing.
    await database.query('update public.students set has_special_needs = true where id = $1', [
      specialNeeds,
    ]);

    const cycleId = await draw(classId, await dayOfMonth());
    const samples = await samplesOf(must(cycleId));
    const drawn = samples.map((sample) => sample.student_id).sort();
    expect(drawn).toEqual([...children, specialNeeds].sort());
    expect(drawn).not.toContain(withoutConsent);
    const [adapted] = await database.query<{ adapted: boolean }>(
      'select adapted from public.pulse_samples where cycle_id = $1 and student_id = $2',
      [cycleId, specialNeeds],
    );
    expect(adapted?.adapted).toBe(true);
  });

  it('spreads a small class over the four weeks', async () => {
    const { classId } = await classWithChildren(6);
    const samples = await samplesOf(must(await draw(classId, await dayOfMonth())));
    expect(samples.map((sample) => sample.week)).toEqual([1, 1, 2, 3, 3, 4]);
  });

  it('gives a class drawn later in the month five children for each week that is left', async () => {
    const { classId } = await classWithChildren(30);
    const cycleId = await draw(classId, await dayOfMonth(15));
    const samples = await samplesOf(must(cycleId));
    expect(samples.filter((sample) => sample.week !== null).map((sample) => sample.week)).toEqual([
      3, 3, 3, 3, 3, 4, 4, 4, 4, 4,
    ]);
    const [cycle] = await database.query(
      'select first_week from public.pulse_cycles where id = $1',
      [cycleId],
    );
    expect(cycle).toMatchObject({ first_week: 3 });

    const { classId: lateClass } = await classWithChildren(5);
    expect(await draw(lateClass, await dayOfMonth(28))).toBeNull();
  });

  it('leaves out Balvatika, higher grades, inactive classes and classes with nobody eligible', async () => {
    const { classId: balvatika } = await classWithChildren(3, { grade: 0 });
    const { classId: gradeFour } = await classWithChildren(3, { grade: 4 });
    const { classId: inactive } = await classWithChildren(3);
    await database.query('update public.class_sections set is_active = false where id = $1', [
      inactive,
    ]);
    const { classId: empty } = await classWithChildren(0);

    for (const classId of [balvatika, gradeFour, inactive, empty]) {
      expect(await draw(classId, await dayOfMonth())).toBeNull();
    }
  });

  it('reads in the class medium', async () => {
    const { classId } = await classWithChildren(3, { medium: 'en' });
    const cycleId = await draw(classId, await dayOfMonth());
    const [cycle] = await database.query<{ language: string }>(
      'select language from public.pulse_cycles where id = $1',
      [cycleId],
    );
    expect(cycle?.language).toBe('en');
  });

  it('draws every eligible class in the daily run, once', async () => {
    const { classId: first } = await classWithChildren(4);
    const { classId: second } = await classWithChildren(4, { grade: 3 });
    const onDate = await dayOfMonth(3);
    await database.query('select private.run_pulse_schedule($1::date)', [onDate]);
    await database.query('select private.run_pulse_schedule($1::date)', [onDate]);
    const rows = await database.query<{ class_section_id: string }>(
      'select class_section_id from public.pulse_cycles where class_section_id = any ($1::uuid[])',
      [[first, second]],
    );
    expect(rows.map((row) => row.class_section_id).sort()).toEqual([first, second].sort());
  });

  it('keeps the night\u2019s other draws when the draw of one class fails', async () => {
    const { classId: failing } = await classWithChildren(4);
    const { classId: working } = await classWithChildren(4);
    // A stand-in for any error in one class's draw.
    await database.query(`
      create function public.refuse_one_pulse_cycle() returns trigger language plpgsql as $$
      begin
        if new.class_section_id = '${failing}'::uuid then
          raise exception 'A simulated failure.';
        end if;
        return new;
      end;
      $$`);
    await database.query(
      `create trigger refuse_one_pulse_cycle before insert on public.pulse_cycles
       for each row execute function public.refuse_one_pulse_cycle()`,
    );
    await database.query('select private.run_pulse_schedule($1::date)', [await dayOfMonth()]);
    const rows = await database.query<{ class_section_id: string }>(
      'select class_section_id from public.pulse_cycles where class_section_id = any ($1::uuid[])',
      [[failing, working]],
    );
    expect(rows.map((row) => row.class_section_id)).toEqual([working]);
  });

  it('keeps the night\u2019s draws when the replacements fail', async () => {
    const { classId: drawnBefore, children } = await classWithChildren(22);
    const cycleId = must(await draw(drawnBefore, await dayOfMonth()));
    const leaving = must((await samplesOf(cycleId))[0]);
    expect(children).toContain(leaving.student_id);
    await database.query(
      `update public.enrolments set ended_on = $2::date
       where student_id = $1 and class_section_id = $3`,
      [leaving.student_id, await dayOfMonth(1), drawnBefore],
    );
    const { classId: drawnTonight } = await classWithChildren(4);
    // A stand-in for any error while replacing.
    await database.query(`
      create function public.refuse_pulse_replacement() returns trigger language plpgsql as $$
      begin
        raise exception 'A simulated failure.';
      end;
      $$`);
    await database.query(
      `create trigger refuse_pulse_replacement before update on public.pulse_samples
       for each row execute function public.refuse_pulse_replacement()`,
    );
    await database.query('select private.run_pulse_schedule($1::date)', [await dayOfMonth(3)]);
    const [tonight] = await database.query<{ count: number }>(
      'select count(*)::int as count from public.pulse_cycles where class_section_id = $1',
      [drawnTonight],
    );
    expect(tonight?.count).toBe(1);
    expect((await samplesOf(cycleId))[0]).toMatchObject({ replaced_at: null });
  });

  it('draws next month ahead from the 25th, so that phones hold its first week in time', async () => {
    const { classId, children } = await classWithChildren(24);
    const [calendar] = await database.query<{ next: string; inYear: boolean }>(
      `select (date_trunc('month', private.today()) + interval '1 month')::date::text as next,
         (date_trunc('month', private.today()) + interval '1 month')::date <= y.ends_on
           as "inYear"
       from public.academic_years as y where y.id = $1`,
      [scenario.academicYearId],
    );
    const { next, inYear } = must(calendar);
    const months = async () =>
      (
        await database.query<{ month: string }>(
          'select month::text from public.pulse_cycles where class_section_id = $1 order by month',
          [classId],
        )
      ).map((row) => row.month);

    await database.query('select private.run_pulse_schedule($1::date)', [await dayOfMonth(23)]);
    expect(await months()).toEqual([await dayOfMonth()]);

    await database.query('select private.run_pulse_schedule($1::date)', [await dayOfMonth(24)]);
    if (!inYear) {
      // Next month belongs to another academic year, whose classes are drawn in their own time.
      expect(await months()).toEqual([await dayOfMonth()]);
      return;
    }
    expect(await months()).toEqual([await dayOfMonth(), next]);
    const [cycle] = await database.query<{ id: string; first_week: number; sample_size: number }>(
      'select id, first_week, sample_size from public.pulse_cycles where class_section_id = $1 and month = $2',
      [classId, next],
    );
    expect(cycle).toMatchObject({ first_week: 1, sample_size: 20 });
    const samples = await samplesOf(must(cycle).id);
    expect(samples[0]).toMatchObject({ week: 1, opens_on: next });
    expect(samples.every((sample) => children.includes(sample.student_id))).toBe(true);

    // A child who leaves before next month is replaced when its cycle begins, not before.
    const leaving = must(samples[0]);
    await database.query(
      `update public.enrolments set ended_on = $2::date
       where student_id = $1 and class_section_id = $3`,
      [leaving.student_id, await dayOfMonth(25), classId],
    );
    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(26)]);
    expect((await samplesOf(must(cycle).id))[0]).toMatchObject({ replaced_at: null });
    await database.query('select private.replace_pulse_samples($1::date)', [next]);
    expect((await samplesOf(must(cycle).id))[0]).toMatchObject({ replacement_reason: 'left' });
  });
});

describe('who sees the drawn children', () => {
  it('shows a teacher only the children whose week has opened, and never the reserve', async () => {
    const { classId } = await classWithChildren(30);
    const cycleId = await draw(classId, await dayOfMonth());

    const visible = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query<{ week: number | null; opens_on: string }>(
        'select week, opens_on::text from public.pulse_samples where cycle_id = $1',
        [cycleId],
      ),
    );
    const [today] = await database.query<{ today: string }>(
      'select private.today()::text as today',
    );
    const opened = (await samplesOf(must(cycleId))).filter(
      (sample) => sample.week !== null && must(sample.opens_on) <= must(today).today,
    );
    expect(visible).toHaveLength(opened.length);
    expect(
      visible.every((sample) => sample.week !== null && sample.opens_on <= must(today).today),
    ).toBe(true);
  });

  it('shows the CRP of the cluster the whole draw, including the reserve', async () => {
    const { classId } = await classWithChildren(30);
    const cycleId = await draw(classId, await dayOfMonth());
    const rows = await database.as(asUser(scenario.staff.crpA), (query) =>
      query('select id from public.pulse_samples where cycle_id = $1', [cycleId]),
    );
    expect(rows).toHaveLength(30);
  });

  it('shows nothing to other schools, other clusters, education officers or families', async () => {
    const { classId } = await classWithChildren(10);
    const cycleId = await draw(classId, await dayOfMonth());
    for (const userId of [
      scenario.staff.teacherA2,
      scenario.staff.crpB,
      scenario.staff.blockOfficer,
      scenario.familyAccountId,
    ]) {
      const samples = await database.as(asUser(userId), (query) =>
        query('select id from public.pulse_samples where cycle_id = $1', [cycleId]),
      );
      const cycles = await database.as(asUser(userId), (query) =>
        query('select id from public.pulse_cycles where id = $1', [cycleId]),
      );
      expect(samples).toEqual([]);
      expect(cycles).toEqual([]);
    }
  });

  it('keeps the seed out of reach of every API user', async () => {
    const { classId } = await classWithChildren(3);
    await draw(classId, await dayOfMonth());
    for (const userId of [scenario.staff.superAdmin, scenario.staff.teacherA1]) {
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) => query('select seed from private.pulse_draws')),
        ),
      ).toBe('42501');
    }
  });

  it('lets nobody change the draw through the API', async () => {
    const { classId } = await classWithChildren(3);
    const cycleId = await draw(classId, await dayOfMonth());
    for (const userId of [
      scenario.staff.superAdmin,
      scenario.staff.crpA,
      scenario.staff.teacherA1,
    ]) {
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) =>
            query('update public.pulse_samples set week = 1 where cycle_id = $1', [cycleId]),
          ),
        ),
      ).toBe('42501');
      expect(
        await errorCodeOf(
          database.as(asUser(userId), (query) =>
            query(
              `insert into public.pulse_cycles (class_section_id, month, grade, language,
                 first_week, eligible_count, sample_size, reserve_size)
               values ($1, date_trunc('month', now())::date, 2, 'hi', 1, 0, 0, 0)`,
              [classId],
            ),
          ),
        ),
      ).toBe('42501');
    }
  });
});

describe('absences and replacements', () => {
  async function openSample(classId: string): Promise<{ cycleId: string; sample: SampleRow }> {
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const sample = must((await samplesOf(cycleId)).find((row) => row.week === 1));
    return { cycleId, sample };
  }

  /** Makes the child's week the current one, so that today is a day of it. */
  async function dueToday(sampleId: string): Promise<void> {
    await database.query(
      `update public.pulse_samples set opens_on = private.today(), due_on = private.today()
       where id = $1`,
      [sampleId],
    );
  }

  it('lets a teacher mark an open child absent today, once per day', async () => {
    const { classId } = await classWithChildren(10);
    const { sample } = await openSample(classId);
    await dueToday(sample.id);
    const mark = () =>
      database.as(asUser(scenario.staff.teacherA1Colleague), (query) =>
        query<{ marked_by: string }>(
          `insert into public.pulse_absences (sample_id, absent_on, marked_by)
           values ($1, private.today(), $2)
           on conflict do nothing
           returning marked_by`,
          [sample.id, scenario.staff.superAdmin],
        ),
      );
    expect(await mark()).toEqual([{ marked_by: scenario.staff.teacherA1Colleague }]);
    expect(await mark()).toEqual([]);
  });

  it('refuses absences outside the child\u2019s week', async () => {
    const { classId } = await classWithChildren(10);
    const { sample } = await openSample(classId);
    await database.query(
      `update public.pulse_samples set opens_on = private.today() - 9, due_on = private.today() - 3
       where id = $1`,
      [sample.id],
    );
    for (const daysAgo of [10, 2, 0]) {
      expect(
        await errorCodeOf(
          database.as(asUser(scenario.staff.teacherA1), (query) =>
            query(
              'insert into public.pulse_absences (sample_id, absent_on) values ($1, private.today() - $2::int)',
              [sample.id, daysAgo],
            ),
          ),
        ),
      ).toBe('23514');
    }
    const accepted = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        'insert into public.pulse_absences (sample_id, absent_on) values ($1, private.today() - 5) returning sample_id',
        [sample.id],
      ),
    );
    expect(accepted).toHaveLength(1);
  });

  it('refuses an absence the attendance register contradicts, and does not count one', async () => {
    const { classId, children } = await classWithChildren(22);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const sample = must((await samplesOf(cycleId))[0]);
    await dueToday(sample.id);
    // Today's attendance shows everyone present.
    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.attendance_sessions (class_section_id, attendance_date, absent_student_ids)
         values ($1, private.today(), '{}')`,
        [classId],
      ),
    );
    expect(children).toContain(sample.student_id);
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(
            'insert into public.pulse_absences (sample_id, absent_on) values ($1, private.today())',
            [sample.id],
          ),
        ),
      ),
    ).toBe('23514');

    // An absence recorded before the register said otherwise does not lead to a replacement.
    await database.query(
      'insert into public.pulse_absences (sample_id, absent_on) values ($1, private.today())',
      [sample.id],
    );
    await database.query('select private.replace_pulse_samples(private.today() + 1)');
    expect(must((await samplesOf(cycleId))[0]).replaced_at).toBeNull();
  });

  it('refuses absences for future days and for children not yet due', async () => {
    const { classId } = await classWithChildren(30);
    const { cycleId, sample } = await openSample(classId);
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(
            `insert into public.pulse_absences (sample_id, absent_on)
             values ($1, private.today() + 1)`,
            [sample.id],
          ),
        ),
      ),
    ).toBe('23514');

    const reserve = must((await samplesOf(cycleId)).find((row) => row.week === null));
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(
            'insert into public.pulse_absences (sample_id, absent_on) values ($1, private.today())',
            [reserve.id],
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('replaces a child absent until the end of the week with the next child in the reserve', async () => {
    const { classId } = await classWithChildren(23);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const before = await samplesOf(cycleId);
    const absent = must(before[0]);
    const notMarked = must(before[1]);
    await database.query(
      'insert into public.pulse_absences (sample_id, absent_on) values ($1, $2::date)',
      [absent.id, await dayOfMonth(2)],
    );

    // Still within the week: nothing happens yet.
    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(6)]);
    expect(must((await samplesOf(cycleId))[20]).week).toBeNull();

    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(7)]);
    const after = await samplesOf(cycleId);
    expect(after[0]).toMatchObject({ replacement_reason: 'absent' });
    expect(must(after[0]).replaced_at).not.toBeNull();
    expect(after[20]).toMatchObject({
      week: 1,
      opens_on: await dayOfMonth(7),
      due_on: await dayOfMonth(13),
      replaces_sample_id: absent.id,
    });
    // A child who was never marked absent stays open, and is late.
    expect(after.find((row) => row.id === notMarked.id)).toMatchObject({ replaced_at: null });
    expect(must(after[21]).week).toBeNull();
  });

  it('keeps a child the register shows present on another day of the week', async () => {
    const { classId } = await classWithChildren(23);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const child = must((await samplesOf(cycleId))[0]);
    // Present on the first day of the week, marked absent on the third, never recorded.
    await database.query(
      `insert into public.attendance_sessions (class_section_id, attendance_date, absent_student_ids)
       values ($1, $2::date, '{}')`,
      [classId, await dayOfMonth()],
    );
    await database.query(
      'insert into public.pulse_absences (sample_id, absent_on) values ($1, $2::date)',
      [child.id, await dayOfMonth(2)],
    );
    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(7)]);
    expect(must((await samplesOf(cycleId))[0]).replaced_at).toBeNull();
  });

  it('replaces a child who left the class at once', async () => {
    const { classId, children } = await classWithChildren(22);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const leaving = must((await samplesOf(cycleId)).find((row) => row.week === 2));
    expect(children).toContain(leaving.student_id);
    await database.query(
      `update public.enrolments set ended_on = $2::date
       where student_id = $1 and class_section_id = $3`,
      [leaving.student_id, await dayOfMonth(1), classId],
    );

    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(8)]);
    const after = await samplesOf(cycleId);
    expect(after.find((row) => row.id === leaving.id)).toMatchObject({
      replacement_reason: 'left',
    });
    expect(after.find((row) => row.replaces_sample_id === leaving.id)).toMatchObject({
      week: 2,
      opens_on: await dayOfMonth(8),
      due_on: await dayOfMonth(13),
    });
  });

  it('gives children replaced during the catching-up days until the end of the month', async () => {
    const { classId } = await classWithChildren(21);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const lastWeek = must((await samplesOf(cycleId)).find((row) => row.week === 4));
    await database.query(
      'insert into public.pulse_absences (sample_id, absent_on) values ($1, $2::date)',
      [lastWeek.id, await dayOfMonth(22)],
    );
    const [monthEnd] = await database.query<{ day: string }>(
      `select (date_trunc('month', private.today()) + interval '1 month' - interval '1 day')::date::text
         as day`,
    );
    if (must(monthEnd).day === (await dayOfMonth(27))) {
      // A 28-day February has no catching-up days, so there is nothing to test this month.
      return;
    }
    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(28)]);
    expect((await samplesOf(cycleId))[20]).toMatchObject({
      week: 4,
      opens_on: await dayOfMonth(28),
      due_on: must(monthEnd).day,
    });
  });

  it('replaces a child whose consent was withdrawn, and skips reserve children without consent', async () => {
    const { classId } = await classWithChildren(23);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const before = await samplesOf(cycleId);
    const withdrawn = must(before.find((row) => row.week === 2));
    const firstReserve = must(before[20]);
    await grantConsent(withdrawn.student_id, false);
    await grantConsent(firstReserve.student_id, false);

    await database.query('select private.replace_pulse_samples($1::date)', [await dayOfMonth(8)]);
    const after = await samplesOf(cycleId);
    expect(after.find((row) => row.id === withdrawn.id)).toMatchObject({
      replacement_reason: 'consent',
    });
    // The first reserve child no longer consents, so the next one comes in.
    expect(must(after[20]).week).toBeNull();
    expect(must(after[21])).toMatchObject({ week: 2, replaces_sample_id: withdrawn.id });
  });

  it('keeps a child whose consent was withdrawn on the eve of the draw in the draw', async () => {
    const { classId, children } = await classWithChildren(4);
    const target = must(children[0]);
    // Consent recorded long ago, withdrawn the day before the draw.
    await database.query(
      `update public.guardian_consents set recorded_at = now() - interval '60 days'
       where student_id = $1`,
      [target],
    );
    await grantConsent(target, false);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const drawn = (await samplesOf(cycleId)).map((row) => row.student_id);
    expect(drawn).toContain(target);
  });

  it('opens the first children of a class drawn mid-week on the day of the draw', async () => {
    const { classId } = await classWithChildren(10);
    const cycleId = must(await draw(classId, await dayOfMonth(10)));
    const opening = (await samplesOf(cycleId)).filter((row) => row.week === 2);
    expect(opening.length).toBeGreaterThan(0);
    const [day] = await database.query<{ day: string }>(
      `select (date_trunc('month', private.today())::date + 10)::text as day`,
    );
    expect(opening.every((row) => row.opens_on === must(day).day)).toBe(true);
  });

  it('leaves the child open when the reserve has run out', async () => {
    const { classId } = await classWithChildren(5);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const [first] = await samplesOf(cycleId);
    await database.query(
      'insert into public.pulse_absences (sample_id, absent_on) values ($1, $2::date)',
      [must(first).id, await dayOfMonth(1)],
    );
    const [replaced] = await database.query<{ count: number }>(
      'select private.replace_pulse_samples($1::date) as count',
      [await dayOfMonth(10)],
    );
    expect(replaced?.count).toBe(0);
    expect((await samplesOf(cycleId))[0]).toMatchObject({ replaced_at: null });
  });
});

describe('recording a check', () => {
  /** Where the device stores a check's recording. */
  const pathOf = (classId: string, sampleId: string, id: string) =>
    `${classId}/${sampleId}/${id}.webm`;

  async function upload(
    userId: string,
    path: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await database.as(asUser(userId), (query) =>
      query(
        `insert into storage.objects (bucket_id, name, owner_id, metadata)
         values ('pulse-audio', $1, auth.uid()::text, $2::jsonb)`,
        [path, JSON.stringify({ size: 180_000, mimetype: 'audio/webm', ...metadata })],
      ),
    );
  }

  interface CheckInput {
    id?: string;
    sampleId: string;
    classId: string;
    attempt?: number;
    itemCode?: string;
    promptCode?: string;
    classroom?: 'normal' | 'noisy';
    recordedAt?: string;
    audioPath?: string;
  }

  function record(userId: string, input: CheckInput) {
    const id = input.id ?? randomUUID();
    const itemCode = input.itemCode ?? 'hi-g2-p01';
    return database.as(asUser(userId), (query) =>
      query(
        `insert into public.pulse_checks (id, sample_id, class_section_id, student_id, attempt,
           item_code, prompt_code, item, audio_path, audio_type, audio_bytes, duration_ms,
           noise_dbfs, reading_level, english_level, clarity, classroom, tags, recorded_at,
           recorded_by)
         values ($1, $2, $3, $4, $5, $6, $7, '{"shown": []}', $8, 'text/plain', 1, 58000,
           -48.5, 'hesitant', 'words', 'clear', $9, '{good_pace}', $10::timestamptz, $11)
         returning id, class_section_id, student_id, mode, recorded_by, audio_type, audio_bytes,
           item_seen_before, audio_etag`,
        [
          id,
          input.sampleId,
          scenario.classB1Grade1Id,
          scenario.students.b1Active,
          input.attempt ?? 1,
          itemCode,
          // The prompt of the same number as the passage, unless one is given.
          input.promptCode ?? itemCode.replace(/^[a-z]{2}-(g\d)-p/, 'en-$1-s'),
          input.audioPath ?? pathOf(input.classId, input.sampleId, id),
          input.classroom ?? 'normal',
          input.recordedAt ?? new Date().toISOString(),
          scenario.staff.superAdmin,
        ],
      ),
    );
  }

  async function openChild(childCount = 10) {
    const { classId } = await classWithChildren(childCount);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const samples = await samplesOf(cycleId);
    return { classId, cycleId, samples, sample: must(samples[0]) };
  }

  it('records a check of an uploaded recording, taking the details from the draw', async () => {
    const { classId, sample } = await openChild();
    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
    const [row] = await record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId });
    expect(row).toMatchObject({
      id,
      class_section_id: classId,
      student_id: sample.student_id,
      mode: 'recorded',
      recorded_by: scenario.staff.teacherA1,
      audio_type: 'audio/webm',
      audio_bytes: 180_000,
      item_seen_before: false,
    });
  });

  it('accepts each check once: a resend of the same check changes nothing', async () => {
    const { classId, sample } = await openChild();
    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id), { eTag: '"a1b2"' });
    await record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId });

    const resent = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.pulse_checks (id, sample_id, item_code, prompt_code, item, audio_path,
           audio_type, audio_bytes, duration_ms, reading_level, english_level, clarity, classroom,
           recorded_at, class_section_id, student_id)
         values ($1, $2, 'hi-g2-p01', 'en-g2-s01', '{}', $3, '', 0, 58000, 'fluent',
           'sentences', 'clear', 'normal', now(), $4, $5)
         on conflict (id) do nothing
         returning id`,
        [id, sample.id, pathOf(classId, sample.id, id), classId, sample.student_id],
      ),
    );
    expect(resent).toEqual([]);

    const other = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, other));
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, { id: other, sampleId: sample.id, classId }),
      ),
    ).toBe('23505');
  });

  it('refuses the same recording sent again for another check', async () => {
    const { classId, samples } = await openChild();
    const [first, second] = [must(samples[0]), must(samples[1])];
    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, first.id, id), { eTag: '"c0ffee"' });
    const [row] = await record(scenario.staff.teacherA1, { id, sampleId: first.id, classId });
    expect(row).toMatchObject({ audio_etag: '"c0ffee"' });

    // The file downloaded and uploaded again, as another child's recording.
    const copy = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, second.id, copy), { eTag: '"c0ffee"' });
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, { id: copy, sampleId: second.id, classId }),
      ),
    ).toBe('23514');
  });

  it('accepts only a passage in the class language and items of the class grade', async () => {
    const { classId, samples } = await openChild();
    const attempts: [string, string][] = [
      ['en-g2-p01', 'en-g2-s01'],
      ['hi-g3-p01', 'en-g2-s01'],
      ['hi-g2-p01', 'en-g1-s01'],
      ['hi-g2-p01', 'hi-g2-s01'],
      ['hi-g2-read-001', 'en-g2-s01'],
    ];
    for (const [index, [itemCode, promptCode]] of attempts.entries()) {
      const sample = must(samples[index]);
      const id = randomUUID();
      await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
      expect(
        await errorCodeOf(
          record(scenario.staff.teacherA1, {
            id,
            sampleId: sample.id,
            classId,
            itemCode,
            promptCode,
          }),
        ),
        `${itemCode} with ${promptCode}`,
      ).toBe('23514');
    }
  });

  it('allows one second recording with a new item, only after a noisy classroom', async () => {
    const { classId, sample, samples } = await openChild();
    const first = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, first));
    await record(scenario.staff.teacherA1, {
      id: first,
      sampleId: sample.id,
      classId,
      classroom: 'noisy',
    });

    const sameItem = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, sameItem));
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, {
          id: sameItem,
          sampleId: sample.id,
          classId,
          attempt: 2,
        }),
      ),
    ).toBe('23514');

    const retake = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, retake));
    const [row] = await record(scenario.staff.teacherA1, {
      id: retake,
      sampleId: sample.id,
      classId,
      attempt: 2,
      itemCode: 'hi-g2-p02',
    });
    expect(row).toMatchObject({ id: retake });

    // A quiet first recording allows no second one.
    const quiet = must(samples[1]);
    const quietFirst = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, quiet.id, quietFirst));
    await record(scenario.staff.teacherA1, { id: quietFirst, sampleId: quiet.id, classId });
    const quietSecond = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, quiet.id, quietSecond));
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, {
          id: quietSecond,
          sampleId: quiet.id,
          classId,
          attempt: 2,
          itemCode: 'hi-g2-p03',
        }),
      ),
    ).toBe('23514');
  });

  it('notes when a child is given an item they have had before', async () => {
    const { classId, sample } = await openChild();
    // Last month's check of the same child, with the passage given again now.
    const [earlier] = await database.query<{ id: string }>(
      `with cycle as (
         insert into public.pulse_cycles (class_section_id, month, grade, language,
           first_week, eligible_count, sample_size, reserve_size)
         values ($1, (date_trunc('month', private.today()) - interval '1 month')::date, 2,
           'hi', 1, 1, 1, 0)
         returning id, month
       )
       insert into public.pulse_samples (cycle_id, class_section_id, student_id, draw_position,
         week, opens_on, due_on)
       select id, $1, $2, 1, 1, month, month + 6 from cycle
       returning id`,
      [classId, sample.student_id],
    );
    const earlierSample = must(earlier).id;
    const earlierCheck = randomUUID();
    const earlierPath = pathOf(classId, earlierSample, earlierCheck);
    await database.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('pulse-audio', $1, $2, '{"size": 1000, "mimetype": "audio/webm"}')`,
      [earlierPath, scenario.staff.teacherA1],
    );
    await database.query(
      `insert into public.pulse_checks (id, sample_id, class_section_id, student_id,
         item_code, prompt_code, item, audio_path, audio_type, audio_bytes, duration_ms,
         reading_level, english_level, clarity, classroom, recorded_at)
       values ($1, $2, $3, $4, 'hi-g2-p01', 'en-g2-s09', '{}', $5, '', 0, 58000,
         'fluent', 'sentences', 'clear', 'normal', now() - interval '1 month')`,
      [earlierCheck, earlierSample, classId, sample.student_id, earlierPath],
    );

    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
    const [row] = await record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId });
    expect(row).toMatchObject({ item_seen_before: true });
  });

  it('refuses a recording once the family has withdrawn consent', async () => {
    const { classId, sample } = await openChild();
    const id = randomUUID();
    // Stored while consent was in force; the check arrives after the withdrawal.
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
    await grantConsent(sample.student_id, false);
    expect(
      await errorCodeOf(record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId })),
    ).toBe('42501');
  });

  it('refuses a check made after the child was replaced, and keeps one made before', async () => {
    const { classId, samples } = await openChild(23);
    const [before, after] = [must(samples[0]), must(samples[1])];
    // Replaced in a few minutes (the check below was made before), and a minute ago.
    await database.query(
      `update public.pulse_samples
       set replaced_at = case when id = $1 then now() + interval '10 minutes'
         else now() - interval '1 minute' end,
         replacement_reason = 'absent'
       where id = any ($2::uuid[])`,
      [before.id, [before.id, after.id]],
    );

    const early = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, before.id, early));
    const [kept] = await record(scenario.staff.teacherA1, {
      id: early,
      sampleId: before.id,
      classId,
    });
    expect(kept).toMatchObject({ id: early });

    const late = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, after.id, late));
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, { id: late, sampleId: after.id, classId }),
      ),
    ).toBe('23514');
  });

  it('asks for the recording again when it is missing, and refuses one uploaded by someone else', async () => {
    const { classId, sample } = await openChild();
    expect(
      await errorCodeOf(record(scenario.staff.teacherA1, { sampleId: sample.id, classId })),
    ).toBe('55000');

    const id = randomUUID();
    await upload(scenario.staff.teacherA1Colleague, pathOf(classId, sample.id, id));
    expect(
      await errorCodeOf(record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId })),
    ).toBe('42501');
  });

  it('refuses a recording stored under another name, or under another child', async () => {
    const { classId, samples } = await openChild();
    const [sample, other] = [must(samples[0]), must(samples[1])];
    const elsewhere = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, elsewhere));
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, {
          sampleId: sample.id,
          classId,
          audioPath: pathOf(classId, sample.id, elsewhere),
        }),
      ),
    ).toBe('23514');

    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, other.id, id));
    expect(
      await errorCodeOf(
        record(scenario.staff.teacherA1, {
          id,
          sampleId: sample.id,
          classId,
          audioPath: pathOf(classId, other.id, id),
        }),
      ),
    ).toBe('23514');
  });

  it('refuses a recording time before the child was due or in the future', async () => {
    const { classId, sample } = await openChild();
    for (const recordedAt of [
      `${await dayOfMonth(-1)}T10:00:00+05:30`,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ]) {
      const id = randomUUID();
      await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
      expect(
        await errorCodeOf(
          record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId, recordedAt }),
        ),
      ).toBe('23514');
    }
  });

  it('lets only teachers of the school record, and only children whose week has opened', async () => {
    const { classId, samples } = await openChild(30);
    const reserve = must(samples.find((row) => row.week === null));
    const id = randomUUID();
    // Stored directly: storage itself refuses the reserve child's folder.
    await database.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('pulse-audio', $1, $2, '{"size": 1000, "mimetype": "audio/webm"}')`,
      [pathOf(classId, reserve.id, id), scenario.staff.teacherA1],
    );
    expect(
      await errorCodeOf(record(scenario.staff.teacherA1, { id, sampleId: reserve.id, classId })),
    ).toBe('42501');

    const open = must(samples[0]);
    const other = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, open.id, other));
    for (const userId of [scenario.staff.teacherA2, scenario.staff.crpA]) {
      expect(await errorCodeOf(record(userId, { id: other, sampleId: open.id, classId }))).toBe(
        '42501',
      );
    }
  });

  it('never lets a check be changed or deleted through the API', async () => {
    const { classId, sample } = await openChild();
    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
    await record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId });
    for (const statement of [
      `update public.pulse_checks set reading_level = 'fluent' where id = $1`,
      'delete from public.pulse_checks where id = $1',
    ]) {
      expect(
        await errorCodeOf(
          database.as(asUser(scenario.staff.superAdmin), (query) => query(statement, [id])),
        ),
      ).toBe('42501');
    }
  });

  it('shows checks to the school and its CRP only', async () => {
    const { classId, sample } = await openChild();
    const id = randomUUID();
    await upload(scenario.staff.teacherA1, pathOf(classId, sample.id, id));
    await record(scenario.staff.teacherA1, { id, sampleId: sample.id, classId });
    const read = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query('select id from public.pulse_checks where id = $1', [id]),
      );
    expect(await read(scenario.staff.crpA)).toHaveLength(1);
    expect(await read(scenario.staff.teacherA1Colleague)).toHaveLength(1);
    expect(await read(scenario.staff.teacherA2)).toEqual([]);
    expect(await read(scenario.staff.blockOfficer)).toEqual([]);
  });
});

describe('recording storage', () => {
  function uploadAs(userId: string, name: string) {
    return database.as(asUser(userId), (query) =>
      query(
        `insert into storage.objects (bucket_id, name, owner_id, metadata)
         values ('pulse-audio', $1, auth.uid()::text, '{"size": 10, "mimetype": "audio/webm"}')`,
        [name],
      ),
    );
  }

  /** A class whose first children are due, and the folder of each drawn child. */
  async function dueClass(childCount = 23) {
    const { classId } = await classWithChildren(childCount);
    const samples = await samplesOf(must(await draw(classId, await dayOfMonth())));
    const folder = (sample: SampleRow) => `${classId}/${sample.id}`;
    return { classId, samples, folder };
  }

  it('is a private bucket for audio of at most 2 MB', async () => {
    const [bucket] = await database.query(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'pulse-audio'`,
    );
    expect(bucket).toMatchObject({
      public: false,
      file_size_limit: 2097152,
      allowed_mime_types: ['audio/webm', 'audio/ogg', 'audio/mp4'],
    });
  });

  it('takes uploads from teachers of the school, into the folder of a child who is due', async () => {
    const { classId, samples, folder } = await dueClass();
    const due = must(samples[0]);
    await uploadAs(scenario.staff.teacherA1, `${folder(due)}/${randomUUID()}.webm`);

    const notYetOpen = must(samples.find((row) => row.week === 4));
    // Whatever today's date, this child's week opens tomorrow.
    await database.query(
      `update public.pulse_samples set opens_on = private.today() + 1, due_on = private.today() + 3
       where id = $1`,
      [notYetOpen.id],
    );
    const reserve = must(samples.find((row) => row.week === null));
    const { classId: otherClass } = await classWithChildren(0);
    for (const name of [
      `${folder(notYetOpen)}/${randomUUID()}.webm`,
      `${folder(reserve)}/${randomUUID()}.webm`,
      `${otherClass}/${due.id}/${randomUUID()}.webm`,
      `${scenario.classB1Grade1Id}/${due.id}/${randomUUID()}.webm`,
      `${classId}/${randomUUID()}/${randomUUID()}.webm`,
      `${classId}/${randomUUID()}.webm`,
      `${folder(due)}/not-a-check.webm`,
      `${folder(due)}/${randomUUID()}.mp3`,
    ]) {
      expect(await errorCodeOf(uploadAs(scenario.staff.teacherA1, name)), name).toBe('42501');
    }
    for (const userId of [
      scenario.staff.crpA,
      scenario.staff.teacherA2,
      scenario.familyAccountId,
    ]) {
      expect(await errorCodeOf(uploadAs(userId, `${folder(due)}/${randomUUID()}.webm`))).toBe(
        '42501',
      );
    }
  });

  it('answers a second upload of the same file as already stored', async () => {
    const { samples, folder } = await dueClass();
    const name = `${folder(must(samples[0]))}/${randomUUID()}.webm`;
    await uploadAs(scenario.staff.teacherA1, name);
    // The device sends the file again after a lost answer; Storage reports it as already there.
    expect(await errorCodeOf(uploadAs(scenario.staff.teacherA1, name))).toBe('23505');
  });

  it('takes no recording of a child whose family has withdrawn consent', async () => {
    const { samples, folder } = await dueClass();
    const child = must(samples[0]);
    await grantConsent(child.student_id, false);
    expect(
      await errorCodeOf(
        uploadAs(scenario.staff.teacherA1, `${folder(child)}/${randomUUID()}.webm`),
      ),
    ).toBe('42501');
  });

  it('lets the school and its CRP listen once a check claims a recording', async () => {
    const { classId, samples, folder } = await dueClass();
    const sample = must(samples[0]);
    const id = randomUUID();
    const name = `${folder(sample)}/${id}.webm`;
    await uploadAs(scenario.staff.teacherA1, name);
    const read = (userId: string) =>
      database.as(asUser(userId), (query) =>
        query('select id from storage.objects where name = $1', [name]),
      );
    // Until a check claims it, only the teacher who uploaded it sees it.
    expect(await read(scenario.staff.teacherA1)).toHaveLength(1);
    expect(await read(scenario.staff.crpA)).toEqual([]);
    expect(await read(scenario.staff.teacherA1Colleague)).toEqual([]);

    await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(
        `insert into public.pulse_checks (id, sample_id, class_section_id, student_id,
           item_code, prompt_code, audio_path, audio_type, audio_bytes, duration_ms,
           reading_level, english_level, clarity, classroom, recorded_at)
         values ($1, $2, $3, $4, 'hi-g2-p01', 'en-g2-s01', $5, '', 0, 58000, 'fluent',
           'sentences', 'clear', 'normal', now())`,
        [id, sample.id, classId, sample.student_id, name],
      ),
    );
    expect(await read(scenario.staff.crpA)).toHaveLength(1);
    expect(await read(scenario.staff.teacherA1Colleague)).toHaveLength(1);
    expect(await read(scenario.staff.teacherB1)).toEqual([]);
    expect(await read(scenario.staff.blockOfficer)).toEqual([]);

    const changed = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query(`update storage.objects set metadata = '{}' where name = $1 returning id`, [name]),
    );
    const deleted = await database.as(asUser(scenario.staff.teacherA1), (query) =>
      query('delete from storage.objects where name = $1 returning id', [name]),
    );
    expect(changed).toEqual([]);
    expect(deleted).toEqual([]);
  });
});

describe('the adapted check of a child with special needs', () => {
  async function adaptedChild() {
    const { classId } = await classWithChildren(0);
    const studentId = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Adapted Learner',
      classSectionId: classId,
    });
    await database.query('update public.students set has_special_needs = true where id = $1', [
      studentId,
    ]);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    return { classId, sample: must((await samplesOf(cycleId))[0]) };
  }

  function observe(userId: string, sampleId: string, mode = 'adapted') {
    return database.as(asUser(userId), (query) =>
      query<{ mode: string; audio_path: string | null }>(
        `insert into public.pulse_checks (sample_id, class_section_id, student_id, mode,
           reading_level, english_level, tags, recorded_at)
         values ($1, $2, $3, $4, 'hesitant', 'no_response', '{needed_prompting}', now())
         returning mode, audio_path`,
        [sampleId, scenario.classB1Grade1Id, scenario.students.b1Active, mode],
      ),
    );
  }

  it("records the teacher's observation without any audio or consent for audio", async () => {
    const { sample } = await adaptedChild();
    expect(await observe(scenario.staff.teacherA1, sample.id)).toEqual([
      { mode: 'adapted', audio_path: null },
    ]);
  });

  it('refuses a recording for the child, and an adapted check for any other child', async () => {
    const { classId, sample } = await adaptedChild();
    const id = randomUUID();
    const path = `${classId}/${sample.id}/${id}.webm`;
    // Storage takes no recording of the child at all.
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(
            `insert into storage.objects (bucket_id, name, owner_id, metadata)
             values ('pulse-audio', $1, auth.uid()::text, '{"size": 10, "mimetype": "audio/webm"}')`,
            [path],
          ),
        ),
      ),
    ).toBe('42501');
    // And the check is refused even when a file is there.
    await database.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('pulse-audio', $1, $2, '{"size": 10, "mimetype": "audio/webm"}')`,
      [path, scenario.staff.teacherA1],
    );
    expect(
      await errorCodeOf(
        database.as(asUser(scenario.staff.teacherA1), (query) =>
          query(
            `insert into public.pulse_checks (id, sample_id, class_section_id, student_id,
               item_code, prompt_code, audio_path, audio_type, audio_bytes, duration_ms,
               reading_level, english_level, clarity, classroom, recorded_at)
             values ($1, $2, $3, $4, 'hi-g2-p01', 'en-g2-s01', $5, '', 0, 58000,
               'fluent', 'words', 'clear', 'normal', now())`,
            [id, sample.id, classId, sample.student_id, path],
          ),
        ),
      ),
    ).toBe('23514');

    const { classId: otherClass } = await classWithChildren(5);
    const other = must((await samplesOf(must(await draw(otherClass, await dayOfMonth()))))[0]);
    expect(await errorCodeOf(observe(scenario.staff.teacherA1, other.id))).toBe('23514');
  });

  it('takes no audio: an adapted check with a recording breaks the rules of the table', async () => {
    const { sample } = await adaptedChild();
    expect(
      await errorCodeOf(
        database.query(
          `insert into public.pulse_checks (sample_id, class_section_id, student_id, mode,
             audio_path, reading_level, english_level, recorded_at)
           values ($1, $2, $3, 'adapted', 'x/y.webm', 'fluent', 'words', now())`,
          [sample.id, scenario.classA1Grade1Id, sample.student_id],
        ),
      ),
    ).toBe('23514');
  });
});

describe('the encrypted weeks', () => {
  interface BatchRow {
    week: number;
    opens_on: string;
    iv: string;
    ciphertext: string;
    mac: string;
  }

  const hex = (column: string) => `'\\x' || encode(${column}, 'hex') as ${column}`;

  async function batchesAs(userId: string, cycleId: string): Promise<BatchRow[]> {
    return database.as(asUser(userId), (query) =>
      query<BatchRow>(
        `select week, opens_on::text, ${hex('iv')}, ${hex('ciphertext')}, ${hex('mac')}
         from public.pulse_week_batches where cycle_id = $1 order by week`,
        [cycleId],
      ),
    );
  }

  async function keysAs(userId: string, cycleId: string) {
    return database.as(asUser(userId), (query) =>
      query<{ week: number; key: string }>(
        `select week, encode(key, 'hex') as key from public.pulse_week_keys
         where cycle_id = $1 order by week`,
        [cycleId],
      ),
    );
  }

  async function today(offset = 0): Promise<string> {
    const [row] = await database.query<{ day: string }>(
      'select (private.today() + $1::int)::text as day',
      [offset],
    );
    return must(row).day;
  }

  it('holds each week of the draw, and opens with its key to exactly the drawn children', async () => {
    const { classId } = await classWithChildren(22);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const samples = await samplesOf(cycleId);
    const batches = await database.query<BatchRow>(
      `select week, opens_on::text, ${hex('iv')}, ${hex('ciphertext')}, ${hex('mac')}
       from public.pulse_week_batches where cycle_id = $1 order by week`,
      [cycleId],
    );
    const keys = await database.query<{ week: number; key: string }>(
      `select week, encode(key, 'hex') as key from public.pulse_week_keys
       where cycle_id = $1 order by week`,
      [cycleId],
    );
    expect(batches.map((batch) => batch.week)).toEqual([1, 2, 3, 4]);

    for (const batch of batches) {
      const key = must(keys.find((entry) => entry.week === batch.week)).key;
      const opened = await openWeek(key, batch);
      expect(opened).toMatchObject({ cycleId, week: batch.week });
      expect(opened.children.map((child) => child.sampleId)).toEqual(
        samples.filter((sample) => sample.week === batch.week).map((sample) => sample.id),
      );
      expect(opened.children.every((child) => !child.adapted)).toBe(true);
    }

    // Another week's key, or an altered batch, opens nothing.
    const first = must(batches[0]);
    await expect(openWeek(must(keys[1]).key, first)).rejects.toBeInstanceOf(WeekKeyError);
    const altered = {
      ...first,
      ciphertext: first.ciphertext.replace(/.$/, (digit) => (digit === '0' ? '1' : '0')),
    };
    await expect(openWeek(must(keys[0]).key, altered)).rejects.toBeInstanceOf(WeekKeyError);
  });

  it('gives a teacher the next two weeks encrypted, and a key only once its week opens', async () => {
    const { classId } = await classWithChildren(22);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const all = await database.query<{ week: number; opens_on: string }>(
      'select week, opens_on::text from public.pulse_week_batches where cycle_id = $1 order by week',
      [cycleId],
    );
    const horizon = await today(14);
    const now = await today();

    const batches = await batchesAs(scenario.staff.teacherA1, cycleId);
    expect(batches.map((batch) => batch.week)).toEqual(
      all.filter((week) => week.opens_on <= horizon).map((week) => week.week),
    );
    const keys = await keysAs(scenario.staff.teacherA1, cycleId);
    expect(keys.map((key) => key.week)).toEqual(
      all.filter((week) => week.opens_on <= now).map((week) => week.week),
    );
  });

  it('gives the CRP the keys of the next two weeks, for unlocking by QR code', async () => {
    const { classId } = await classWithChildren(22);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const all = await database.query<{ week: number; opens_on: string }>(
      'select week, opens_on::text from public.pulse_week_keys where cycle_id = $1 order by week',
      [cycleId],
    );
    const horizon = await today(14);
    expect((await keysAs(scenario.staff.crpA, cycleId)).map((key) => key.week)).toEqual(
      all.filter((week) => week.opens_on <= horizon).map((week) => week.week),
    );
    expect(await batchesAs(scenario.staff.crpA, cycleId)).toHaveLength(all.length);
  });

  it('shows nothing of them to other schools, other clusters, officers or families', async () => {
    const { classId } = await classWithChildren(10);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    for (const userId of [
      scenario.staff.teacherA2,
      scenario.staff.crpB,
      scenario.staff.blockOfficer,
      scenario.familyAccountId,
    ]) {
      expect(await batchesAs(userId, cycleId)).toEqual([]);
      expect(await keysAs(userId, cycleId)).toEqual([]);
    }
  });

  it('marks the children with special needs in the encrypted week', async () => {
    const { classId } = await classWithChildren(0);
    const studentId = await insertStudent(database.query, {
      schoolId: scenario.schoolA1Id,
      fullName: 'Adapted Learner',
      classSectionId: classId,
    });
    await database.query('update public.students set has_special_needs = true where id = $1', [
      studentId,
    ]);
    const cycleId = must(await draw(classId, await dayOfMonth()));
    const [batch] = await database.query<BatchRow>(
      `select week, opens_on::text, ${hex('iv')}, ${hex('ciphertext')}, ${hex('mac')}
       from public.pulse_week_batches where cycle_id = $1`,
      [cycleId],
    );
    const [key] = await database.query<{ key: string }>(
      `select encode(key, 'hex') as key from public.pulse_week_keys where cycle_id = $1`,
      [cycleId],
    );
    const opened = await openWeek(must(key).key, must(batch));
    expect(opened.children).toEqual([
      { sampleId: expect.any(String) as string, studentId, adapted: true },
    ]);
  });
});
