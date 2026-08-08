import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  // Deterministic bytes so the test asserts the id's STRUCTURE rather than its
  // randomness: every byte is 0xff, which also proves the version and variant
  // nibbles are masked in rather than left as-is.
  getRandomValues: (array: Uint8Array) => array.fill(0xff),
}));

const { isNoteId, newNoteId } = await import('@/lib/db/ids');

describe('newNoteId', () => {
  it('produces an id the server will accept', () => {
    expect(isNoteId(newNoteId())).toBe(true);
  });

  it('masks the version and variant bits over whatever the randomness gave', () => {
    const id = newNoteId();
    // Version nibble, first character of the third group.
    expect(id[14]).toBe('7');
    // Variant, first character of the fourth group: 8, 9, a or b.
    expect('89ab').toContain(id[19]);
  });

  it('sorts by creation time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const earlier = newNoteId();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_001_000);
    const later = newNoteId();
    vi.restoreAllMocks();

    // The point of v7 over v4: lexicographic order matches creation order, so
    // inserts append to the primary key's index instead of scattering.
    expect(earlier < later).toBe(true);
  });
});

describe('isNoteId', () => {
  it('rejects the id shapes the previous storage engine used', () => {
    // A 24-character ObjectId, which this database has never held.
    expect(isNoteId('507f1f77bcf86cd799439011')).toBe(false);
    // A v4 UUID: right length, wrong version nibble.
    expect(isNoteId('9b2fd0a4-3c1e-4f8a-9c3d-2b7e5a1f4c6d')).toBe(false);
    expect(isNoteId('')).toBe(false);
  });
});
