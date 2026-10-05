/** Oxy owns attachment bytes and the effective account quota. Never allocate a Noted allowance. */
export interface StorageIdentity { accountId: string | null; sessionId: string | null }
export function sameStorageIdentity(a: StorageIdentity, b: StorageIdentity): boolean {
  return !!a.accountId && !!a.sessionId && a.accountId === b.accountId && a.sessionId === b.sessionId;
}
/** A file picker can remain open across an account switch or sign-out. */
export function scopedAttachmentSelection(identity: StorageIdentity, current: () => StorageIdentity, attach: (ids: string[]) => void) {
  return (ids: string[]) => { if (sameStorageIdentity(identity, current())) attach(ids); };
}
export interface SharedStorageUsage { totalUsedBytes: number; totalLimitBytes: number; quotaEnforcement?: 'metadata_admission' | 'unconfigured'; reservedBytes?: string | number | null }
/** reservedBytes is TOTAL quota consumption: active + trash + uncleaned holds, not an extra allowance. */
function formatGB(bytes: bigint): string {
  const hundredths = (bytes + 5_000_000n) / 10_000_000n;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  const decimal = new Intl.NumberFormat().formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  return whole.toLocaleString() + (fraction ? `${decimal}${fraction}` : '');
}
export function displayStorageUsage(usage: SharedStorageUsage): { usedGB: string; limitGB: string; configured: boolean; reservedGB: string | null; heldGB: string | null; availableGB: string | null; hasHolds: boolean } {
  if (![usage.totalUsedBytes, usage.totalLimitBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid Oxy storage usage');
  const used = BigInt(usage.totalUsedBytes);
  const limit = BigInt(usage.totalLimitBytes);
  const configured = usage.quotaEnforcement === 'metadata_admission';
  let reserved: bigint | null = null;
  if (configured && usage.reservedBytes != null) {
    const raw = usage.reservedBytes;
    if (typeof raw === 'number') {
      if (!Number.isSafeInteger(raw) || raw < 0) throw new Error('Invalid Oxy quota reservation');
    } else if (!/^(0|[1-9][0-9]*)$/.test(raw) || raw.length > 100) throw new Error('Invalid Oxy quota reservation');
    reserved = BigInt(raw);
    // The API reads totals separately. Never infer more space from a smaller reserved snapshot.
    if (reserved < used) reserved = used;
  }
  const held = reserved === null ? null : reserved - used;
  const available = reserved === null ? null : limit > reserved ? limit - reserved : 0n;
  return { usedGB: formatGB(used), limitGB: formatGB(limit), configured,
    reservedGB: reserved === null ? null : formatGB(reserved), heldGB: held === null ? null : formatGB(held),
    availableGB: available === null ? null : formatGB(available), hasHolds: held !== null && held > 0n };
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
