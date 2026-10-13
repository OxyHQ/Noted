/**
 * Reading a picked file — the neutral build.
 *
 * Metro resolves `read-file.native.ts` on a phone and `read-file.web.ts` in a
 * browser, because a picked file is a path on one and a `File` on the other.
 * This is what a non-Metro resolver gets, and it refuses rather than pretending.
 */

import type { DocumentPickerAsset } from 'expo-document-picker';

export function readPickedText(_asset: DocumentPickerAsset): Promise<string> {
  return Promise.reject(new Error('reading a picked file is not supported on this platform'));
}
