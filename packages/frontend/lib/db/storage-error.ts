/** Known browser failures get useful recovery instructions without deleting data. */
export function storageErrorKind(message: string | null): 'locked' | 'reload' | 'paused' | 'other' {
  if (message && /NoModificationAllowedError|createSyncAccessHandle|Access Handles.*same file/i.test(message)) return 'locked';
  if (message && /Invalid VFS state/i.test(message)) return 'reload';
  if (message && /NOTED_BROKER_TIMEOUT/i.test(message)) return 'paused';
  return 'other';
}
