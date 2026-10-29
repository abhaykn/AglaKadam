import { describe, expect, it, vi } from 'vitest';
import {
  demoEmail,
  handleDemoStart,
  handleDemoSweep,
  handleDemoSwitch,
  HISTORY_STEPS,
  type RecordingSource,
} from '../../../supabase/functions/demo/handler.ts';
import {
  RECORDINGS,
  recordingBytes,
  type DemoRecording,
} from '../../../supabase/functions/demo/recordings.ts';
import type { DemoServices } from '../../../supabase/functions/_shared/services.ts';

const SANDBOX = '0b9c5d1e-2f3a-4b5c-8d6e-7f8091a2b3c4';

const PLACES = {
  posted_on: '2024-04-01',
  accounts: [
    { role: 'teacher', full_name: 'Anita Sharma', scope: 'school-1' },
    { role: 'crp', full_name: 'Rajeev Kumar Mishra', scope: 'cluster-1' },
    { role: 'officer', full_name: 'Suresh Chandra Dubey', scope: 'block-1' },
    { role: 'family', student: 'student-7' },
  ],
  staff: [
    { slot: 'teacher-01', role: 'teacher', full_name: 'Sunita Devi', scope: 'school-1' },
    { slot: 'crp-01', role: 'crp', full_name: 'Sushma Yadav', scope: 'cluster-2' },
  ],
};

const RECORDING: DemoRecording = {
  key: 'class-2-halting',
  type: 'audio/mp4',
  grade: 2,
  itemCode: 'hi-g2-p04',
  promptCode: 'en-g2-s03',
  durationMs: 41000,
  bytes: 3,
  teacherReading: 'fluent',
  teacherEnglish: 'words',
  shown: [{ level: 'passage', atMs: 0 }],
  score: { reading_level: 'hesitant' },
};

/**
 * The database's side as the function sees it: identities recorded for each district, those the
 * district took in, and those listed to be deleted once a district is removed.
 */
function fakeServices(overrides: Partial<DemoServices> = {}) {
  const steps: { phase: string; details: unknown }[] = [];
  const created: { email: string; metadata: Record<string, unknown> }[] = [];
  const noted = new Map<string, string>();
  const takenIn = new Set<string>();
  const toDelete = new Set<string>();
  const spies = {
    open: vi.fn(() => Promise.resolve({ status: 'ok' as const, sandbox: SANDBOX })),
    build: vi.fn((_sandbox: string, phase: string, details: unknown = {}) => {
      steps.push({ phase, details });
      if (phase === 'people') {
        // The district takes in its staff for good (they are shared) and its visitors' accounts.
        const posted = details as { staff: Record<string, string> };
        for (const id of Object.values(posted.staff)) {
          takenIn.add(id);
        }
      }
      if (phase === 'places') {
        return Promise.resolve(PLACES as Record<string, unknown>);
      }
      if (phase === 'finish') {
        return Promise.resolve({
          uploads: [{ key: RECORDING.key, path: 'class/sample/check.m4a', type: 'audio/mp4' }],
        });
      }
      return Promise.resolve({});
    }),
    createAccount: vi.fn((email: string, metadata: Record<string, unknown>) => {
      created.push({ email, metadata });
      return Promise.resolve(`user-${String(created.length)}`);
    }),
    noteAccount: vi.fn((sandbox: string, userId: string) => {
      noted.set(userId, sandbox);
      return Promise.resolve();
    }),
    deleteAccount: vi.fn<(userId: string) => Promise<void>>(() => Promise.resolve()),
    signInToken: vi.fn((email: string) => Promise.resolve(`token-for-${email}`)),
    accountEmail: vi.fn((_sandbox: string, role: string) =>
      Promise.resolve(demoEmail(role, SANDBOX)),
    ),
    sandboxOf: vi.fn(() => Promise.resolve(SANDBOX as string | null)),
    storeFile: vi.fn(() => Promise.resolve()),
    removeFiles: vi.fn(() => Promise.resolve()),
    due: vi.fn(() =>
      Promise.resolve([
        {
          sandbox: SANDBOX,
          files: { 'pulse-audio': ['class/sample/check.webm'], 'class-notes': [] },
        },
      ]),
    ),
    expire: vi.fn(() => Promise.resolve()),
    removing: vi.fn(() => Promise.resolve()),
    remove: vi.fn((sandbox: string) => {
      for (const [id, of] of noted) {
        if (of === sandbox && !takenIn.has(id)) {
          toDelete.add(id);
        }
      }
      return Promise.resolve();
    }),
    accountsToDelete: vi.fn((limit: number) => Promise.resolve([...toDelete].slice(0, limit))),
    accountDeleted: vi.fn((userId: string) => {
      toDelete.delete(userId);
      noted.delete(userId);
      return Promise.resolve();
    }),
    jobTokenIsValid: vi.fn((token: string) => Promise.resolve(token === 'job-token')),
  };
  const services: DemoServices = { ...spies, ...overrides };
  return { services, spies, steps, created, noted, takenIn, toDelete };
}

const recordings: RecordingSource = {
  list: [RECORDING],
  bytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
};

describe('starting a demonstration', () => {
  it('builds the district step by step and signs the visitor in to the role chosen', async () => {
    const { services, spies, steps, created } = fakeServices();
    const result = await handleDemoStart(
      { role: 'crp', language: 'en' },
      'network',
      services,
      recordings,
      true,
    );
    expect(result).toEqual({
      status: 200,
      body: { token_hash: `token-for-${demoEmail('crp', SANDBOX)}`, role: 'crp' },
    });
    expect(steps.map((entry) => entry.phase)).toEqual([
      'places',
      'people',
      ...HISTORY_STEPS,
      'finish',
    ]);

    // The background staff in Hindi, the visitor's accounts in their language, none with a
    // password to change; an officer is a block officer.
    expect(created.map((entry) => entry.email)).toEqual([
      demoEmail('teacher-01', SANDBOX),
      demoEmail('crp-01', SANDBOX),
      demoEmail('teacher', SANDBOX),
      demoEmail('crp', SANDBOX),
      demoEmail('officer', SANDBOX),
      demoEmail('family', SANDBOX),
    ]);
    expect(created[4]?.metadata).toEqual({
      provisioning: {
        account_kind: 'staff',
        full_name: 'Suresh Chandra Dubey',
        preferred_language: 'en',
        password_change_required: false,
        assignment: { role: 'block_officer', scope_id: 'block-1', starts_on: '2024-04-01' },
      },
    });
    expect(created[5]?.metadata).toEqual({
      provisioning: { account_kind: 'student', student_id: 'student-7', preferred_language: 'en' },
    });
    expect(steps[1]?.details).toEqual({
      accounts: {
        teacher: { id: 'user-3', email: demoEmail('teacher', SANDBOX) },
        crp: { id: 'user-4', email: demoEmail('crp', SANDBOX) },
        officer: { id: 'user-5', email: demoEmail('officer', SANDBOX) },
        family: { id: 'user-6', email: demoEmail('family', SANDBOX) },
      },
      staff: { 'teacher-01': 'user-1', 'crp-01': 'user-2' },
    });

    // The sample recording goes where the district placed it.
    expect(steps.at(-1)?.details).toMatchObject({
      recordings: [{ key: RECORDING.key, item_code: 'hi-g2-p04', teacher_reading: 'fluent' }],
    });
    expect(spies.storeFile).toHaveBeenCalledWith(
      'pulse-audio',
      'class/sample/check.m4a',
      new Uint8Array([1, 2, 3]),
      'audio/mp4',
    );
  });

  it('refuses a role it does not know, and does nothing while switched off', async () => {
    const { services, spies } = fakeServices();
    expect(
      (await handleDemoStart({ role: 'admin' }, 'network', services, recordings, true)).status,
    ).toBe(400);
    expect(
      (await handleDemoStart({ role: 'crp' }, 'network', services, recordings, false)).body,
    ).toEqual({
      error: { code: 'not_configured' },
    });
    expect(spies.open).not.toHaveBeenCalled();
  });

  it('says when every place is taken, or the network opened too many', async () => {
    const busy = fakeServices({ open: vi.fn(() => Promise.resolve({ status: 'busy' as const })) });
    expect(
      await handleDemoStart({ role: 'teacher' }, 'network', busy.services, recordings, true),
    ).toEqual({
      status: 503,
      body: { error: { code: 'busy' } },
    });
    const throttled = fakeServices({
      open: vi.fn(() => Promise.resolve({ status: 'throttled' as const, retryAfterSeconds: 1200 })),
    });
    expect(
      await handleDemoStart({ role: 'teacher' }, 'network', throttled.services, recordings, true),
    ).toEqual({ status: 429, body: { error: { code: 'throttled', retry_after_seconds: 1200 } } });
    expect(busy.spies.build).not.toHaveBeenCalled();
    const noSession = fakeServices({
      open: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
    });
    expect(
      await handleDemoStart({ role: 'teacher' }, 'network', noSession.services, recordings, true),
    ).toEqual({ status: 503, body: { error: { code: 'not_configured' } } });
    expect(noSession.spies.build).not.toHaveBeenCalled();
  });

  it('leaves nothing behind when building fails', async () => {
    const early = fakeServices();
    early.spies.build.mockImplementation((_sandbox: string, phase: string) =>
      phase === 'places'
        ? Promise.resolve(PLACES as Record<string, unknown>)
        : Promise.reject(new Error('people failed')),
    );
    await expect(
      handleDemoStart({ role: 'family' }, 'network', early.services, recordings, true),
    ).rejects.toThrow('people failed');
    // Before the accounts were posted, every one of them goes, background staff included, and the
    // district ends at once in case removing it fails as well.
    expect(early.spies.deleteAccount).toHaveBeenCalledTimes(6);
    expect(early.spies.expire).toHaveBeenCalledWith(SANDBOX);
    expect(early.spies.remove).toHaveBeenCalledWith(SANDBOX);
    expect(early.toDelete.size).toBe(0);

    const late = fakeServices();
    late.spies.build.mockImplementation((_sandbox: string, phase: string, details: unknown) => {
      if (phase === 'people') {
        for (const id of Object.values((details as { staff: Record<string, string> }).staff)) {
          late.takenIn.add(id);
        }
      }
      return phase === 'pulse'
        ? Promise.reject(new Error('pulse failed'))
        : Promise.resolve(phase === 'places' ? (PLACES as Record<string, unknown>) : {});
    });
    await expect(
      handleDemoStart({ role: 'family' }, 'network', late.services, recordings, true),
    ).rejects.toThrow('pulse failed');
    // Afterwards the background staff are shared with other districts and stay.
    expect(late.spies.deleteAccount.mock.calls.map((call) => call[0])).toEqual([
      'user-3',
      'user-4',
      'user-5',
      'user-6',
    ]);
  });
});

describe('identities that outlive a failure', () => {
  it('records each identity as soon as it exists, before the district takes it in', async () => {
    const { services, spies, noted } = fakeServices();
    spies.build.mockImplementation((_sandbox: string, phase: string) =>
      phase === 'places'
        ? Promise.resolve(PLACES as Record<string, unknown>)
        : new Promise(() => undefined),
    );
    // The function stops while the district is taking its people in: every identity is on record.
    void handleDemoStart({ role: 'crp' }, 'network', services, recordings, true);
    await vi.waitFor(() => {
      expect(noted.size).toBe(6);
    });
    expect([...noted.values()].every((sandbox) => sandbox === SANDBOX)).toBe(true);
  });

  it('keeps an identity on the list until the Auth service has deleted it', async () => {
    const { services, spies, toDelete } = fakeServices();
    toDelete.add('left-1');
    toDelete.add('left-2');
    spies.deleteAccount.mockImplementation((id: string) =>
      id === 'left-1' ? Promise.reject(new Error('Auth is down')) : Promise.resolve(),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await handleDemoSweep('job-token', services);
    expect(result.body).toMatchObject({ accounts_deleted: 1, accounts_failed: 2 });
    expect([...toDelete]).toEqual(['left-1']);
  });
});

describe('switching roles', () => {
  it('signs a visitor in to another role of their own district', async () => {
    const { services, spies } = fakeServices();
    const result = await handleDemoSwitch(
      { action: 'switch', role: 'officer' },
      'user-4',
      services,
    );
    expect(result.body).toEqual({
      token_hash: `token-for-${demoEmail('officer', SANDBOX)}`,
      role: 'officer',
    });
    expect(spies.sandboxOf).toHaveBeenCalledWith('user-4');
  });

  it('refuses anyone who is not a demonstration visitor', async () => {
    const { services } = fakeServices({ sandboxOf: vi.fn(() => Promise.resolve(null)) });
    expect((await handleDemoSwitch({ role: 'crp' }, 'real-user', services)).status).toBe(403);
    expect((await handleDemoSwitch({ role: 'crp' }, null, services)).status).toBe(401);
  });
});

describe('the hourly sweep', () => {
  it('removes files, data and then accounts of expired districts', async () => {
    const { services, spies, noted } = fakeServices();
    noted.set('user-1', SANDBOX);
    noted.set('user-2', SANDBOX);
    expect(await handleDemoSweep('job-token', services)).toEqual({
      status: 200,
      body: { removed: 1, failed: 0, accounts_deleted: 2, accounts_failed: 0 },
    });
    expect(spies.removeFiles).toHaveBeenCalledWith('pulse-audio', ['class/sample/check.webm']);
    expect(spies.removeFiles).toHaveBeenCalledTimes(1);
    expect(spies.remove).toHaveBeenCalledWith(SANDBOX);
    // A district that keeps failing waits behind the others the next time.
    expect(spies.removing.mock.invocationCallOrder[0]).toBeLessThan(
      spies.removeFiles.mock.invocationCallOrder[0] ?? 0,
    );
    expect(spies.deleteAccount.mock.calls.map((call) => call[0])).toEqual(['user-1', 'user-2']);
    expect(spies.accountDeleted).toHaveBeenCalledTimes(2);
  });

  it('answers only the database job', async () => {
    const { services, spies } = fakeServices();
    expect((await handleDemoSweep('guess', services)).status).toBe(403);
    expect((await handleDemoSweep(null, services)).status).toBe(403);
    expect(spies.due).not.toHaveBeenCalled();
  });
});

describe('the sample recordings', () => {
  it('carry their own file, of the class they are for, each one the CRP should hear', () => {
    expect(RECORDINGS.length).toBeGreaterThan(0);
    for (const recording of RECORDINGS) {
      const bytes = recordingBytes(recording.key);
      expect(bytes.length).toBe(recording.bytes);
      // WebM files begin with the EBML header.
      expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
      expect(recording.itemCode).toMatch(new RegExp(`^hi-g${String(recording.grade)}-p[0-9]{2}$`));
      expect(recording.promptCode).toMatch(
        new RegExp(`^en-g${String(recording.grade)}-s[0-9]{2}$`),
      );
      expect(recording.durationMs).toBeLessThanOrEqual(61000);
      const flags = recording.score.flags as string[];
      expect(
        recording.score.reading_level !== recording.teacherReading ||
          flags.includes('low_confidence'),
      ).toBe(true);
    }
  });
});
