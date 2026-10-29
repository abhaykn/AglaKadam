import { describe, expect, it } from 'vitest';
import { attendanceChange } from './attendance-change';

/**
 * A demonstration district's identifiers are made from a hash (`md5(key)::uuid`), so their version
 * and variant digits are not those of a random UUID. A change carrying them must still be kept on
 * the device: a stricter check refused every offline save in a demonstration district.
 */
const HASHED = {
  class: 'c4ca4238-a0b9-2382-0dcc-509a6f75849b',
  child: 'c81e728d-9d4c-2f63-6f06-7f89cc14862c',
  change: 'eccbc87e-4b5c-e2fe-2830-8fd9f2a7baf3',
} as const;

describe('identifiers made from a hash', () => {
  it('are accepted in a change kept on the device', () => {
    // Not valid RFC 9562 UUIDs: the version digit is 0 and the variant digit is 0.
    const odd = '0f1e2d3c-4b5a-0968-0776-655443322110';
    const ids = [odd, HASHED.class, HASHED.child];
    const parsed = attendanceChange.schema.safeParse({
      classSectionId: ids[0],
      date: '2026-10-29',
      absentStudentIds: [ids[1], ids[2]],
      changeId: HASHED.change,
      supersedes: [],
      baseUpdatedAt: null,
      classLabel: { grade: 2, section: 'A' },
    });
    expect(parsed.success).toBe(true);
  });

  it('still refuse what is not shaped like an identifier', () => {
    const parsed = attendanceChange.schema.safeParse({
      classSectionId: 'not-an-id',
      date: '2026-10-29',
      absentStudentIds: [],
      changeId: HASHED.change,
      supersedes: [],
      baseUpdatedAt: null,
      classLabel: { grade: 2, section: 'A' },
    });
    expect(parsed.success).toBe(false);
  });
});
