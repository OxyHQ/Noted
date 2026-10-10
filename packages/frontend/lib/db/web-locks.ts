import { Platform } from 'react-native';

/** Browser-owned locks survive timer throttling and release when a tab dies. */
export function browserLocks(): LockManager | null {
  return Platform.OS === 'web' && typeof navigator !== 'undefined'
    ? (navigator.locks ?? null)
    : null;
}

export function accountLockName(kind: string, viewerId: string, resourceId?: string): string {
  // JSON preserves opaque IDs: escaping/sanitizing can alias two accounts.
  return `noted:${kind}:${JSON.stringify([viewerId, resourceId ?? null])}`;
}

/** Keep the complete read/network/reconcile cycle exclusive across tabs. */
export async function withAccountSyncLock<T>(viewerId: string, work: () => Promise<T>): Promise<T> {
  const locks = browserLocks();
  return locks ? locks.request(accountLockName('sync', viewerId), work) : work();
}

/** Take a lifetime lease without queueing behind an existing live owner. */
export function acquireBrowserLease(name: string): Promise<(() => void) | null> {
  const locks = browserLocks();
  if (!locks) return Promise.resolve(() => undefined);
  return new Promise((resolve, reject) => {
    void locks
      .request(name, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        await new Promise<void>((release) => {
          resolve(release);
        });
      })
      .catch(reject);
  });
}
