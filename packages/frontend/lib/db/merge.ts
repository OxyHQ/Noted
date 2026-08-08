/**
 * Conflict resolution for the pull half of syncing.
 *
 * Pure on purpose: it is the one piece of the sync loop where a wrong answer
 * silently destroys something the user typed, so it must be testable without a
 * database, a network, or a device.
 */

/** What the local store knows about a note the server just sent. */
export interface LocalNoteState {
  /** Last local write, which moves on every keystroke. */
  updatedAt: string;
  /**
   * The server's `updatedAt` as of the last time this note was in agreement with
   * the server — null for a note that has never been confirmed by it.
   */
  serverUpdatedAt: string | null;
  /** Local edits the server has not acknowledged yet. */
  dirty: boolean;
}

export type MergeAction =
  /** Take the server's version. */
  | 'apply'
  /** Keep the local version; the outbox will push it. */
  | 'skip'
  /**
   * Both sides changed independently. The local version stays (it is the text
   * the user can still see and has not finished sending), and the server's is
   * kept alongside it so nothing is thrown away silently.
   */
  | 'conflict';

/**
 * Decide what to do with an incoming server version of a note.
 *
 * The comparison is against `serverUpdatedAt`, never against `updatedAt`: a
 * local timestamp moves on every keystroke and on a device whose clock is
 * wrong, so "is the local copy newer" is not a question two machines can agree
 * on. "Has the server changed since we last agreed" is, because both sides are
 * reading the same server-issued value.
 */
export function decideMerge(local: LocalNoteState | null, serverUpdatedAt: string): MergeAction {
  if (!local) return 'apply';
  if (!local.dirty) return 'apply';
  // Local edits on top of exactly the version the server still holds: ours is
  // strictly the newer one, and the outbox is already carrying it.
  if (local.serverUpdatedAt === serverUpdatedAt) return 'skip';
  return 'conflict';
}

/**
 * Whether a server-side deletion should be applied locally.
 *
 * Unconditionally yes, including over unsynced local edits. Deleting forever is
 * an explicit, deliberate act performed on another device; resurrecting the note
 * because this device happened to hold an unsent edit would override a decision
 * the user actually made with one they never expressed.
 */
export function shouldApplyDeletion(): boolean {
  return true;
}

/* ── Retry pacing ──────────────────────────────────────────────── */

export const OUTBOX_BASE_DELAY_MS = 2_000;
export const OUTBOX_MAX_DELAY_MS = 5 * 60 * 1_000;
/**
 * After this many consecutive failures an entry stops being retried on its own
 * and waits for the next explicit sync (app foreground, reconnect). It is never
 * dropped: the local note remains the user's, unsent.
 */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Exponential backoff, capped, for an entry that has failed `attempts` times. */
export function outboxRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  // 2^30 ms is already far past the cap; clamping the exponent keeps the shift
  // away from overflow territory for an entry that somehow retried forever.
  const scaled = OUTBOX_BASE_DELAY_MS * 2 ** Math.min(exponent, 30);
  return Math.min(scaled, OUTBOX_MAX_DELAY_MS);
}
