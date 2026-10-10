/** A fresh document replaces a poisoned Expo worker without deleting OPFS. */
export function reloadWebStore(): boolean {
  if (typeof window === 'undefined') return false;
  window.location.reload();
  return true;
}
