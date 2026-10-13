export const SYNC_MAX_LIMIT = 1000;

/** `null` means the caller did not ask for pages; `'invalid'` is a 400. */
export function parseSyncLimit(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 'invalid';
  const value = Number(raw);
  return value >= 1 && value <= SYNC_MAX_LIMIT ? value : 'invalid';
}

export interface SyncPage<T> {
  rows: T[];
  /** Where the next request resumes; null when this was the last page. */
  nextCursor: string | null;
  /**
   * Set when the rows fetched are all one instant and the run may be longer than
   * the fetch: the caller reads the whole run at this instant instead.
   */
  wholeRunAt?: Date;
}

/**
 * Trim `fetched` (ordered by `updatedAt`, at most `limit + 1` rows) to a page.
 *
 * The cursor is a timestamp and the next request asks for strictly later rows,
 * so a page may not end in the middle of a run of rows sharing one `updatedAt`
 * (`/reorder` writes many with the same instant): the rest of the run would be
 * skipped for good. The page therefore stops before the first timestamp that
 * does not fit whole, and the cursor is the last timestamp it did include. A
 * single run longer than `limit` is returned whole instead — a big page beats a
 * hole.
 */
export function cutSyncPage<T extends { updatedAt: Date }>(
  fetched: T[],
  limit: number,
): SyncPage<T> {
  if (fetched.length <= limit) return { rows: fetched, nextCursor: null };
  const firstExcluded = fetched[limit].updatedAt.getTime();
  const whole = fetched.filter((row) => row.updatedAt.getTime() < firstExcluded);
  if (whole.length > 0) {
    return { rows: whole, nextCursor: whole[whole.length - 1].updatedAt.toISOString() };
  }
  const at = fetched[0].updatedAt;
  return { rows: fetched, nextCursor: at.toISOString(), wholeRunAt: at };
}
