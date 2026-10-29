import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { classRosterQuery, type RosterEntry } from '@/features/attendance/attendance-api';
import { lockedWeeks, unlockWeek, viewOn, type PulseCycleView } from './pulse-api';
import { pulseCycleKey, type PulseChild } from './pulse-change';
import {
  hexToBytes,
  openWeek,
  readWeekUnlockCode,
  weekUnlockCode,
  WeekKeyError,
  type EncryptedWeek,
} from './week-batch';

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    throw new Error('These tests run without a network.');
  },
}));

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const randomKey = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

async function derive(key: Uint8Array<ArrayBuffer>, purpose: string): Promise<ArrayBuffer> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', hmacKey, encoder.encode(purpose));
}

/** Encrypts a week the way the database does (AES-256-CBC, then HMAC-SHA-256 of IV and text). */
async function sealWeek(keyHex: string, payload: unknown): Promise<EncryptedWeek> {
  const key = hexToBytes(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    await derive(key, 'enc'),
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      encryptionKey,
      encoder.encode(JSON.stringify(payload)),
    ),
  );
  const macKey = await crypto.subtle.importKey(
    'raw',
    await derive(key, 'mac'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = new Uint8Array(iv.length + ciphertext.length);
  signed.set(iv, 0);
  signed.set(ciphertext, iv.length);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, signed));
  // The Data API returns bytea as hex with the `\x` prefix of Postgres.
  return { iv: `\\x${toHex(iv)}`, ciphertext: `\\x${toHex(ciphertext)}`, mac: `\\x${toHex(mac)}` };
}

const CYCLE_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const SAMPLE_A = '0b8c7c55-6c6e-4f7c-9a4b-2f3a1e5d6c7b';
const SAMPLE_B = '1c9d8d66-7d7f-4a8d-8b5c-3a4b2f6e7d8c';
const STUDENT_A = '2dae9e77-8e80-4b9e-9c6d-4b5c3a7f8e9d';
const STUDENT_B = '3ebfaf88-9f91-4caf-8d7e-5c6d4b8a9fae';

const weekPayload = (week: number, cycle = CYCLE_ID) => ({
  v: 1,
  cycle,
  week,
  children: [
    { sample: SAMPLE_A, student: STUDENT_A, adapted: false },
    { sample: SAMPLE_B, student: STUDENT_B, adapted: true },
  ],
});

/** The value, or a failed test when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error('Expected a value, but there was none.');
  }
  return value;
}

/** Flips one bit of a hex string at a byte position. */
function flipByte(hex: string, position: number): string {
  const bytes = hexToBytes(hex);
  bytes[position] = (bytes[position] ?? 0) ^ 0x01;
  return toHex(bytes);
}

describe('opening an encrypted week', () => {
  it('opens a week the database sealed, with its children', async () => {
    const key = randomKey();
    const opened = await openWeek(key, await sealWeek(key, weekPayload(2)));
    expect(opened).toEqual({
      cycleId: CYCLE_ID,
      week: 2,
      children: [
        { sampleId: SAMPLE_A, studentId: STUDENT_A, adapted: false },
        { sampleId: SAMPLE_B, studentId: STUDENT_B, adapted: true },
      ],
    });
    // The key may also arrive with the Postgres prefix.
    await expect(openWeek(`\\x${key}`, await sealWeek(key, weekPayload(2)))).resolves.toEqual(
      opened,
    );
  });

  it('opens nothing with another key, or when the batch was altered', async () => {
    const key = randomKey();
    const sealed = await sealWeek(key, weekPayload(1));
    await expect(openWeek(randomKey(), sealed)).rejects.toBeInstanceOf(WeekKeyError);
    await expect(
      openWeek(key, { ...sealed, ciphertext: flipByte(sealed.ciphertext, 3) }),
    ).rejects.toBeInstanceOf(WeekKeyError);
    await expect(openWeek(key, { ...sealed, iv: flipByte(sealed.iv, 0) })).rejects.toBeInstanceOf(
      WeekKeyError,
    );
    await expect(
      openWeek(key, { ...sealed, mac: flipByte(sealed.mac, 31) }),
    ).rejects.toBeInstanceOf(WeekKeyError);
  });

  it('refuses keys of the wrong length or with other characters', async () => {
    const key = randomKey();
    const sealed = await sealWeek(key, weekPayload(1));
    await expect(openWeek(key.slice(0, 62), sealed)).rejects.toBeInstanceOf(WeekKeyError);
    await expect(openWeek(`${key.slice(0, 63)}g`, sealed)).rejects.toBeInstanceOf(WeekKeyError);
    expect(() => hexToBytes('abc')).toThrow(WeekKeyError);
  });

  it('refuses a genuine batch whose content is not a week of children', async () => {
    const key = randomKey();
    const refuse = async (payload: unknown) =>
      expect(openWeek(key, await sealWeek(key, payload))).rejects.toBeInstanceOf(WeekKeyError);
    await refuse({ ...weekPayload(1), v: 2 });
    await refuse({ ...weekPayload(1), cycle: 'not-a-cycle' });
    await refuse({ ...weekPayload(1), children: [{ sample: SAMPLE_A, student: 'someone' }] });
    await refuse('just text');
  });
});

describe('the CRP’s unlock code', () => {
  it('carries the cycle, the week and the key, and reads back the same', () => {
    const key = randomKey();
    const code = weekUnlockCode(CYCLE_ID, 3, `\\x${key.toUpperCase()}`);
    expect(code).toBe(`AK-PULSE:1:${CYCLE_ID}:3:${key}`);
    expect(readWeekUnlockCode(`  ${code}\n`)).toEqual({ cycleId: CYCLE_ID, week: 3, keyHex: key });
    expect(readWeekUnlockCode(code.toUpperCase())).toEqual({
      cycleId: CYCLE_ID,
      week: 3,
      keyHex: key,
    });
  });

  it('ignores anything that is not an unlock code', () => {
    const key = randomKey();
    expect(readWeekUnlockCode('https://example.org')).toBeNull();
    expect(readWeekUnlockCode(`AK-PULSE:2:${CYCLE_ID}:3:${key}`)).toBeNull();
    expect(readWeekUnlockCode(`AK-PULSE:1:${CYCLE_ID}:5:${key}`)).toBeNull();
    expect(readWeekUnlockCode(`AK-PULSE:1:${CYCLE_ID}:0:${key}`)).toBeNull();
    expect(readWeekUnlockCode(`AK-PULSE:1:${CYCLE_ID}:3:${key.slice(2)}`)).toBeNull();
    expect(readWeekUnlockCode(`AK-PULSE:1:${'-'.repeat(36)}:3:${key}`)).toBeNull();
  });
});

describe('unlocking a week on the teacher’s phone', () => {
  const MONTH = '2026-10-01';
  const TODAY = '2026-10-12';
  const CLASS_ID = '4fc0b099-a0a2-4dba-9e8f-6d7e5c9b0aaf';

  const knownChild: PulseChild = {
    sampleId: '5ad1c1aa-b1b3-4ecb-8f90-7e8f6dac1bb0',
    studentId: '6be2d2bb-c2c4-4fdc-9a01-8f907ebd2cc1',
    name: 'Ravi',
    studentCode: '1000000016',
    adapted: false,
    week: 1,
    opensOn: MONTH,
    dueOn: '2026-10-07',
    replacesSampleId: null,
    replacedAt: null,
    replacementReason: null,
    checks: [],
    absences: [],
  };

  const roster: RosterEntry[] = [
    {
      studentId: STUDENT_A,
      fullName: 'Asha',
      studentCode: '1000000008',
      enrolledOn: '2026-04-01',
      endedOn: null,
    },
    {
      studentId: STUDENT_B,
      fullName: 'Mina',
      studentCode: '1000000032',
      enrolledOn: '2026-04-01',
      endedOn: null,
    },
  ];

  async function setUp() {
    const keys = { 1: randomKey(), 2: randomKey(), 3: randomKey() };
    const view: PulseCycleView = {
      cycle: {
        id: CYCLE_ID,
        month: MONTH,
        grade: 2,
        language: 'hi',
        firstWeek: 1,
        sampleSize: 20,
        eligibleCount: 30,
      },
      children: [knownChild],
      seenItems: {},
      weeks: [
        {
          week: 1,
          opensOn: MONTH,
          batch: await sealWeek(keys[1], weekPayload(1)),
          key: keys[1],
        },
        // Opened while the phone was offline: children and key never arrived.
        {
          week: 2,
          opensOn: '2026-10-08',
          batch: await sealWeek(keys[2], weekPayload(2)),
          key: null,
        },
        {
          week: 3,
          opensOn: '2026-10-15',
          batch: await sealWeek(keys[3], weekPayload(3)),
          key: null,
        },
        { week: 4, opensOn: '2026-10-22', batch: null, key: null },
      ],
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(pulseCycleKey(CLASS_ID), view);
    queryClient.setQueryData(classRosterQuery(CLASS_ID).queryKey, roster);
    const current = () => queryClient.getQueryData<PulseCycleView>(pulseCycleKey(CLASS_ID));
    return { keys, view, queryClient, current };
  }

  it('lists only the opened weeks whose children are missing', async () => {
    const { view } = await setUp();
    expect(lockedWeeks(view, TODAY).map((week) => week.week)).toEqual([2]);
    expect(lockedWeeks(view, '2026-10-23').map((week) => week.week)).toEqual([2, 3, 4]);
  });

  it('adds the week’s children, named from the class list, once', async () => {
    const { keys, queryClient, current } = await setUp();
    const code = weekUnlockCode(CYCLE_ID, 2, keys[2]);
    await expect(unlockWeek(queryClient, CLASS_ID, code, TODAY)).resolves.toEqual({
      kind: 'unlocked',
      week: 2,
      children: 2,
    });

    const view = current();
    expect(view?.children.map((child) => child.name)).toEqual(['Ravi', 'Asha', 'Mina']);
    expect(view?.children[2]).toEqual({
      sampleId: SAMPLE_B,
      studentId: STUDENT_B,
      name: 'Mina',
      studentCode: '1000000032',
      adapted: true,
      week: 2,
      opensOn: '2026-10-08',
      dueOn: '2026-10-14',
      replacesSampleId: null,
      replacedAt: null,
      replacementReason: null,
      checks: [],
      absences: [],
    });
    expect(view?.weeks.find((week) => week.week === 2)?.key).toBe(keys[2]);
    expect(view && lockedWeeks(view, TODAY)).toEqual([]);

    // Scanning the same code again adds nobody twice.
    await expect(unlockWeek(queryClient, CLASS_ID, code, TODAY)).resolves.toMatchObject({
      kind: 'unlocked',
      children: 0,
    });
    expect(current()?.children).toHaveLength(3);
  });

  it('leaves the name empty when the class list on the phone does not know the child', async () => {
    const { keys, queryClient, current } = await setUp();
    queryClient.setQueryData(classRosterQuery(CLASS_ID).queryKey, roster.slice(0, 1));
    await unlockWeek(queryClient, CLASS_ID, weekUnlockCode(CYCLE_ID, 2, keys[2]), TODAY);
    expect(current()?.children.map((child) => child.name)).toEqual(['Ravi', 'Asha', '']);
  });

  it('explains why a code does not unlock a week, and changes nothing', async () => {
    const { keys, view, queryClient, current } = await setUp();
    const outcome = (text: string) => unlockWeek(queryClient, CLASS_ID, text, TODAY);

    expect(await outcome('a shop’s QR code')).toEqual({ kind: 'not-a-code' });
    expect(
      await outcome(weekUnlockCode('7cf3e3cc-d3d5-40ed-8b12-90a18fce3dd2', 2, keys[2])),
    ).toEqual({ kind: 'other-class' });
    expect(await outcome(weekUnlockCode(CYCLE_ID, 3, keys[3]))).toEqual({ kind: 'not-open' });
    expect(await outcome(weekUnlockCode(CYCLE_ID, 4, randomKey()))).toEqual({
      kind: 'not-on-device',
    });
    expect(await outcome(weekUnlockCode(CYCLE_ID, 2, keys[1]))).toEqual({ kind: 'wrong-key' });
    expect(current()).toEqual(view);
  });

  it('refuses a batch that belongs to another week, even with its genuine key', async () => {
    const { keys, view, queryClient, current } = await setUp();
    // A copy of week 1's batch put in the place of week 2.
    queryClient.setQueryData(pulseCycleKey(CLASS_ID), {
      ...view,
      weeks: view.weeks.map((week) =>
        week.week === 2 ? { ...week, batch: view.weeks[0]?.batch ?? null } : week,
      ),
    });
    await expect(
      unlockWeek(queryClient, CLASS_ID, weekUnlockCode(CYCLE_ID, 2, keys[1]), TODAY),
    ).resolves.toEqual({ kind: 'wrong-key' });
    expect(current()?.children).toHaveLength(1);
  });

  it('takes over next month’s cycle on a phone that was offline when the month changed', async () => {
    const { view } = await setUp();
    const NEXT_CYCLE = '7cf3e3cc-d3d5-40ed-8b12-90a18fce3dd2';
    const nextKey = randomKey();
    const queryClient = new QueryClient();
    queryClient.setQueryData(pulseCycleKey(CLASS_ID), {
      ...view,
      seenItems: { [STUDENT_A]: ['hi-g2-p03'] },
      upcoming: {
        cycle: { ...must(view.cycle), id: NEXT_CYCLE, month: '2026-11-01' },
        weeks: [
          {
            week: 1,
            opensOn: '2026-11-01',
            batch: await sealWeek(nextKey, weekPayload(1, NEXT_CYCLE)),
            key: null,
          },
        ],
      },
    } satisfies PulseCycleView);
    queryClient.setQueryData(classRosterQuery(CLASS_ID).queryKey, roster);
    const stored = () => must(queryClient.getQueryData<PulseCycleView>(pulseCycleKey(CLASS_ID)));

    // Until the month changes, this month's cycle stays.
    expect(viewOn(stored(), '2026-10-31').cycle?.id).toBe(CYCLE_ID);

    const november = viewOn(stored(), '2026-11-02');
    expect(november.cycle?.id).toBe(NEXT_CYCLE);
    expect(november.children).toEqual([]);
    expect(lockedWeeks(november, '2026-11-02').map((week) => week.week)).toEqual([1]);

    await expect(
      unlockWeek(queryClient, CLASS_ID, weekUnlockCode(NEXT_CYCLE, 1, nextKey), '2026-11-02'),
    ).resolves.toEqual({ kind: 'unlocked', week: 1, children: 2 });
    expect(stored()).toMatchObject({
      cycle: { id: NEXT_CYCLE },
      upcoming: null,
      seenItems: { [STUDENT_A]: ['hi-g2-p03'] },
    });
    expect(stored().children.map((child) => [child.name, child.dueOn])).toEqual([
      ['Asha', '2026-11-07'],
      ['Mina', '2026-11-07'],
    ]);
    // The cycle of the month that ended no longer opens anything.
    await expect(
      unlockWeek(queryClient, CLASS_ID, weekUnlockCode(CYCLE_ID, 2, randomKey()), '2026-11-02'),
    ).resolves.toEqual({ kind: 'other-class' });
  });

  it('needs the class’s cycle on the phone', async () => {
    const queryClient = new QueryClient();
    await expect(
      unlockWeek(queryClient, CLASS_ID, weekUnlockCode(CYCLE_ID, 2, randomKey()), TODAY),
    ).resolves.toEqual({ kind: 'other-class' });
  });
});
