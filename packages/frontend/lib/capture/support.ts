/**
 * Whether this device can record at all.
 *
 * Asked BEFORE offering the control, not after failing: a button that opens a
 * microphone prompt and then reports an error is worse than one that is not
 * there, because the user has already granted something for nothing.
 */

import { Platform } from 'react-native';

/**
 * Recording is native-only today.
 *
 * Not a policy — a fact about the platform. `expo-file-system`'s `File` and
 * `Directory` are empty stubs on web (`ExpoFileSystem.web.d.ts` declares both
 * with a bare constructor and no methods), so `directory.create()` throws even
 * after the browser has granted the microphone. There is nowhere to put the
 * recording, which is why this is checked rather than caught.
 *
 * Making it work on web is real work, not a flag: a `MediaRecorder` capture, an
 * OPFS or IndexedDB home for the audio, and a `wakeLock` so the tab is not
 * suspended mid-meeting. Until that exists the honest answer is that the phone
 * does this.
 */
export function isCaptureSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
