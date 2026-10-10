import { accountLockName, acquireBrowserLease, browserLocks } from '@/lib/db/web-locks';

const leases = new Map<string, () => void>();

export async function claimCapture(viewerId: string | null, captureId: string): Promise<void> {
  if (!viewerId) throw new Error('A recording needs an active account');
  const key = accountLockName('capture', viewerId, captureId);
  if (leases.has(key)) throw new Error('This recording is already active');
  const release = await acquireBrowserLease(key);
  if (!release) throw new Error('This recording is active in another tab');
  leases.set(key, release);
}

/** Called only once the microphone has stopped, including failed persistence. */
export function releaseCapture(viewerId: string | null, captureId: string): void {
  if (!viewerId) return;
  const key = accountLockName('capture', viewerId, captureId);
  leases.get(key)?.();
  leases.delete(key);
}

/** A held lease proves another tab still owns this recording, even offline. */
export async function recoverUnownedCapture<T>(
  viewerId: string,
  captureId: string,
  recover: () => Promise<T>,
): Promise<T | null> {
  const key = accountLockName('capture', viewerId, captureId);
  if (leases.has(key)) return null;
  const locks = browserLocks();
  return locks
    ? locks.request(key, { ifAvailable: true }, (lock) => (lock ? recover() : null))
    : recover();
}
