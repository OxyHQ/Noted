/**
 * When Noted asks for Face ID / a fingerprint again.
 *
 * Pure, so the rules a lock lives or dies by — when it engages, when it never
 * can — are tested without a device. Nothing here knows about the OS prompt.
 */

/** Away from the app for less than this and it is still unlocked: answering a text is not leaving. */
export const LOCK_GRACE_MS = 30_000;

export interface LockInput {
  /** The person turned the lock on (a per-device setting). */
  enabled: boolean;
  /** The device can authenticate right now: hardware present AND something enrolled. */
  canAuthenticate: boolean;
}

/**
 * Whether the lock exists at all.
 *
 * A lock that cannot be opened must not engage. If the person removes their last
 * fingerprint and passcode while the setting is on, `canAuthenticate` goes false
 * and the app has to open: a gate nobody can pass is data loss with extra steps.
 */
export function lockApplies(input: LockInput): boolean {
  return input.enabled && input.canAuthenticate;
}

/** The lock's state at a cold start: locked, if it applies. */
export function initialLocked(input: LockInput): boolean {
  return lockApplies(input);
}

/**
 * Whether coming back to the foreground should lock the app.
 *
 * @param backgroundedAt when the app left the foreground (ms epoch), or null if
 *   it is not known to have — in which case it stays as it is.
 */
export function lockOnReturn(
  input: LockInput,
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (!lockApplies(input) || backgroundedAt === null) return false;
  return now - backgroundedAt >= LOCK_GRACE_MS;
}
