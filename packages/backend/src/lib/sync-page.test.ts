import { describe, expect, it } from 'bun:test';
import { cutSyncPage, parseSyncLimit } from './sync-page';

const at = (ms: number, id: string) => ({ id, updatedAt: new Date(ms) });

describe('parseSyncLimit', () => {
  it('treats a missing limit as "no paging"', () => {
    expect(parseSyncLimit(undefined)).toBeNull();
    expect(parseSyncLimit('')).toBeNull();
  });
  it('rejects anything that is not 1..1000', () => {
    for (const bad of ['0', '-1', '1001', '1.5', 'abc', ['1']]) {
      expect(parseSyncLimit(bad)).toBe('invalid');
    }
    expect(parseSyncLimit('500')).toBe(500);
  });
});

describe('cutSyncPage', () => {
  it('returns everything and no cursor when the rows fit', () => {
    const rows = [at(1, 'a'), at(2, 'b')];
    expect(cutSyncPage(rows, 2)).toEqual({ rows, nextCursor: null });
  });

  it('never splits a run of rows sharing one instant', () => {
    const fetched = [at(1, 'a'), at(2, 'b'), at(2, 'c'), at(3, 'd')];
    const page = cutSyncPage(fetched, 2);
    expect(page.rows.map((r) => r.id)).toEqual(['a']);
    expect(page.nextCursor).toBe(new Date(1).toISOString());
  });

  it('asks for the whole run when one instant fills the page', () => {
    const fetched = [at(5, 'a'), at(5, 'b'), at(5, 'c')];
    const page = cutSyncPage(fetched, 2);
    expect(page.wholeRunAt).toEqual(new Date(5));
    expect(page.nextCursor).toBe(new Date(5).toISOString());
  });
});
