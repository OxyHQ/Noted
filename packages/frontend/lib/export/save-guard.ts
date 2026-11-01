/** Stop an account-owned export before its next side effect after a session change. */
export function assertExportCurrent(isCurrent?: () => boolean): void {
  if (isCurrent && !isCurrent()) throw new Error('The active account changed during export');
}
