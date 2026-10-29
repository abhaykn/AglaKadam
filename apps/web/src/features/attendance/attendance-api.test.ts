import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ChangeRejectedError } from '@/features/offline/sync-errors';
import type { AppSupabaseClient } from '@/lib/supabase';
import {
  attendanceChange,
  attendanceDedupeKey,
  nextSaveIdentity,
  ownSavesOf,
  rollOn,
  STALE_ATTENDANCE,
  type AttendanceChange,
  type RosterEntry,
} from './attendance-api';
import { addDays, formatDay, isCalendarDate } from './dates';

const from = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from }),
}));

function entry(overrides: Partial<RosterEntry>): RosterEntry {
  return {
    studentId: 's1',
    fullName: 'Asha',
    studentCode: '1000000008',
    enrolledOn: '2026-04-01',
    endedOn: null,
    ...overrides,
  };
}

describe('the roll of a day', () => {
  const roster = [
    entry({ studentId: 'b', fullName: 'Ravi' }),
    entry({ studentId: 'a', fullName: 'Asha' }),
    entry({ studentId: 'late', fullName: 'Kiran', enrolledOn: '2026-10-15' }),
    entry({ studentId: 'left', fullName: 'Meena', endedOn: '2026-10-10' }),
    // A child who moved section within the class keeps one place on the roll.
    entry({ studentId: 'a', fullName: 'Asha', enrolledOn: '2026-10-11' }),
  ];

  it('counts children enrolled on that day, in name order, each once', () => {
    expect(rollOn(roster, '2026-10-12').map((child) => child.studentId)).toEqual(['a', 'b']);
  });

  it('includes a child on the day they joined and on the day they left', () => {
    expect(rollOn(roster, '2026-10-15').map((child) => child.studentId)).toContain('late');
    expect(rollOn(roster, '2026-10-10').map((child) => child.studentId)).toContain('left');
  });
});

describe('calendar dates', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('accepts only real dates', () => {
    expect(isCalendarDate('2026-10-18')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('18-10-2026')).toBe(false);
    expect(isCalendarDate(20261018)).toBe(false);
  });

  it('formats a day for reading in either language', () => {
    expect(formatDay('2026-10-18', 'en')).toMatch(/18/);
    expect(formatDay('2026-10-18', 'hi')).toMatch(/18/);
  });
});

type Operation = 'insert' | 'update' | 'read';
interface Answer {
  data: unknown;
  error: { code: string; message: string } | null;
}

/**
 * A stand-in for the Data API table: records what was asked and answers each kind of request
 * (insert, update or read) with the next of the given results.
 */
function fakeTable(answers: Partial<Record<Operation, Answer[]>>) {
  const requests: { operation: Operation; values?: unknown; filters: [string, unknown][] }[] = [];
  from.mockImplementation(() => {
    const request: (typeof requests)[number] = { operation: 'read', filters: [] };
    requests.push(request);
    const builder: Record<string, unknown> = {
      insert: (values: unknown) => {
        request.operation = 'insert';
        request.values = values;
        return builder;
      },
      update: (values: unknown) => {
        request.operation = 'update';
        request.values = values;
        return builder;
      },
      select: () => builder,
      eq: (column: string, value: unknown) => {
        request.filters.push([column, value]);
        return builder;
      },
      single: () => builder,
      maybeSingle: () => builder,
      then: (resolve: (value: Answer | undefined) => unknown) =>
        Promise.resolve(answers[request.operation]?.shift()).then(resolve),
    };
    return builder;
  });
  return requests;
}

const CLASS_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ASHA = '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b';
const RAVI = '1c9d8d66-7d7f-4a8d-8b5c-3a4b2f6e7d8c';
const THIS_SAVE = '2dae9e77-8e80-4b9e-9c6d-4b5c3a7f8e9d';
const EARLIER_SAVE = '3ebfaf88-9f91-4caf-8d7e-5c6d4b8a9fae';
const SOMEONE_ELSE = '4fc0b099-a0a2-4db0-9e8f-6d7e5c9b0abf';

function savedRow(absent: string[], changeId: string, updatedAt = 'v1') {
  return {
    attendance_date: '2026-10-18',
    absent_student_ids: absent,
    enrolled_count: 30,
    present_count: 30 - absent.length,
    updated_at: updatedAt,
    client_change_id: changeId,
  };
}

/** Sends through the handler, as the outbox does, with the stand-in client. */
function send(change: AttendanceChange): Promise<unknown> {
  return attendanceChange.send(change, {
    supabase: { from } as unknown as AppSupabaseClient,
    readFile: () => Promise.reject(new Error('Attendance carries no files.')),
  });
}

describe('sending attendance', () => {
  const change = {
    classSectionId: CLASS_ID,
    date: '2026-10-18',
    absentStudentIds: [ASHA],
    changeId: THIS_SAVE,
    supersedes: [EARLIER_SAVE],
    baseUpdatedAt: null,
    classLabel: { grade: 2, section: 'A' },
  };

  it('adds a day that had no record, stamped with this save', async () => {
    const requests = fakeTable({ insert: [{ data: savedRow([ASHA], THIS_SAVE), error: null }] });
    await expect(send(change)).resolves.toMatchObject({
      date: '2026-10-18',
      presentCount: 29,
      enrolledCount: 30,
    });
    expect(requests[0]).toMatchObject({
      operation: 'insert',
      values: {
        class_section_id: CLASS_ID,
        attendance_date: '2026-10-18',
        absent_student_ids: [ASHA],
        client_change_id: THIS_SAVE,
      },
    });
  });

  it('changes a recorded day only if it is still the version the teacher started from', async () => {
    const requests = fakeTable({
      update: [{ data: [savedRow([RAVI], THIS_SAVE, 'v2')], error: null }],
    });
    await send({ ...change, absentStudentIds: [RAVI], baseUpdatedAt: 'v1' });
    expect(requests[0]?.operation).toBe('update');
    expect(requests[0]?.filters).toContainEqual(['updated_at', 'v1']);
  });

  it('recognises this very save when the answer to an earlier attempt was lost', async () => {
    // The server dropped a child who left the roll, so the lists differ; the stamp still matches.
    fakeTable({
      insert: [{ data: null, error: { code: '23505', message: 'duplicate key' } }],
      read: [{ data: savedRow([], THIS_SAVE), error: null }],
    });
    await expect(send(change)).resolves.toMatchObject({ absentStudentIds: [] });
  });

  it('puts a newer correction on top of the same device’s earlier save', async () => {
    const requests = fakeTable({
      update: [
        { data: [], error: null },
        { data: [savedRow([ASHA], THIS_SAVE, 'v3')], error: null },
      ],
      read: [{ data: savedRow([RAVI], EARLIER_SAVE, 'v2'), error: null }],
    });
    await expect(send({ ...change, baseUpdatedAt: 'v1' })).resolves.toMatchObject({
      absentStudentIds: [ASHA],
      updatedAt: 'v3',
    });
    expect(requests[2]?.filters).toContainEqual(['updated_at', 'v2']);
  });

  it('refuses to overwrite a record someone else saved meanwhile', async () => {
    fakeTable({
      update: [{ data: [], error: null }],
      read: [{ data: savedRow([RAVI], SOMEONE_ELSE, 'v2'), error: null }],
    });
    const sending = send({ ...change, baseUpdatedAt: 'v1' });
    await expect(sending).rejects.toBeInstanceOf(ChangeRejectedError);
    await expect(sending).rejects.toMatchObject({ code: STALE_ATTENDANCE });
  });

  it('passes other server errors on, so the engine can decide what to do', async () => {
    fakeTable({ insert: [{ data: null, error: { code: '42501', message: 'denied' } }] });
    await expect(send(change)).rejects.toMatchObject({ code: '42501' });
  });

  it('remembers the saves a new save replaces', () => {
    expect(nextSaveIdentity(null).supersedes).toEqual([]);
    const next = nextSaveIdentity(change);
    expect(next.supersedes).toEqual([EARLIER_SAVE, THIS_SAVE]);
    expect(next.changeId).not.toBe(THIS_SAVE);
    // Saves already sent count too, even when the list of recorded days never loaded.
    expect(nextSaveIdentity(null, [SOMEONE_ELSE]).supersedes).toEqual([SOMEONE_ELSE]);
    expect(nextSaveIdentity(change, [EARLIER_SAVE]).supersedes).toEqual([EARLIER_SAVE, THIS_SAVE]);
  });

  it('remembers what this device sent, without the list of recorded days', async () => {
    const queryClient = new QueryClient();
    fakeTable({ insert: [{ data: savedRow([ASHA], THIS_SAVE), error: null }] });
    attendanceChange.onSent?.(change, await send(change), queryClient);
    expect(ownSavesOf(queryClient, CLASS_ID, '2026-10-18')).toEqual([THIS_SAVE]);
    expect(ownSavesOf(queryClient, CLASS_ID, '2026-10-17')).toEqual([]);
    expect(
      queryClient.getQueryCache().find({ queryKey: ['attendance-own-saves', CLASS_ID] })?.meta,
    ).toEqual({ persist: true });
  });

  it('checks saved data before sending it', () => {
    expect(attendanceChange.schema.safeParse(change).success).toBe(true);
    expect(attendanceChange.schema.safeParse({ ...change, date: '18/10/2026' }).success).toBe(
      false,
    );
    expect(
      attendanceChange.schema.safeParse({ ...change, absentStudentIds: ['not-an-id'] }).success,
    ).toBe(false);
  });

  it('replaces an unsent save of the same class and day', () => {
    expect(attendanceDedupeKey('c1', '2026-10-18')).toBe(attendanceDedupeKey('c1', '2026-10-18'));
    expect(attendanceDedupeKey('c1', '2026-10-18')).not.toBe(
      attendanceDedupeKey('c1', '2026-10-17'),
    );
  });
});
