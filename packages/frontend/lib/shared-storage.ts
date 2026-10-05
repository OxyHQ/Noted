/** Oxy owns attachment bytes and the effective account quota. Never allocate a Noted allowance. */
export interface StorageIdentity { accountId: string | null; sessionId: string | null }
export function sameStorageIdentity(a: StorageIdentity, b: StorageIdentity): boolean {
  return !!a.accountId && !!a.sessionId && a.accountId === b.accountId && a.sessionId === b.sessionId;
}
/** A file picker can remain open across an account switch or sign-out. */
export function scopedAttachmentSelection(identity: StorageIdentity, current: () => StorageIdentity, attach: (ids: string[]) => void) {
  return (ids: string[]) => { if (sameStorageIdentity(identity, current())) attach(ids); };
}
export interface SharedStorageUsage { totalUsedBytes: number; totalLimitBytes: number; quotaEnforcement?: 'metadata_admission' | 'unconfigured'; reservedBytes?: string | null }
export function displayStorageUsage(usage: SharedStorageUsage): { usedGB: string; limitGB: string; configured: boolean } {
  if (![usage.totalUsedBytes, usage.totalLimitBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid Oxy storage usage');
  return { usedGB: (usage.totalUsedBytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }), limitGB: (usage.totalLimitBytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }), configured: usage.quotaEnforcement === 'metadata_admission' };
}

export function attachmentMetadataKey(identity: StorageIdentity, fileId: string) {
  return ['file-metadata', identity.accountId, identity.sessionId, fileId] as const;
}
/** Never publish a private attachment response to a different active session. */
export async function readScopedStorage<T>(identity: StorageIdentity, current: () => StorageIdentity, read: () => Promise<T>): Promise<T> {
  if (!sameStorageIdentity(identity, current())) throw new Error('Storage account changed');
  const result = await read();
  if (!sameStorageIdentity(identity, current())) throw new Error('Storage account changed');
  return result;
}
