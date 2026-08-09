/**
 * Keeping the microphone open while the app is in the background.
 *
 * ## Why this module exists at all
 *
 * On iOS, `UIBackgroundModes: ["audio"]` plus an active recording session is
 * enough — nothing here runs. On Android it is not: since Android 14 a process
 * may only hold the microphone in the background from inside a foreground
 * service **declared with type `microphone`**, and `startForeground` throws
 * outright if the type is missing from the manifest. Without this, a recording
 * dies as soon as the user switches app, with no error the JS side can see.
 *
 * Two rules the platform enforces that shape the API:
 *
 * - The service can only be started while the app is in the foreground. That is
 *   why there is no "start recording in the background" entry point: the user
 *   presses a button, and only then does the microphone open.
 * - The notification is not optional and not dismissible. A recording the user
 *   cannot see is one they cannot stop, so the ongoing notification is the
 *   feature rather than a formality.
 */

import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';

interface NotedCaptureNativeModule {
  startCaptureService(title: string, body: string): void;
  stopCaptureService(): void;
  isCaptureServiceRunning(): boolean;
}

/**
 * The native module, or null off Android.
 *
 * Resolved lazily and defensively: a JS bundle can reach a build that predates
 * the module (an OTA update onto an older binary), and a missing native module
 * must degrade to "no background service" rather than crash the app on import.
 */
let nativeModule: NotedCaptureNativeModule | null | undefined;

function getNativeModule(): NotedCaptureNativeModule | null {
  if (nativeModule !== undefined) return nativeModule;
  if (Platform.OS !== 'android') {
    nativeModule = null;
    return nativeModule;
  }
  try {
    nativeModule = requireNativeModule<NotedCaptureNativeModule>('NotedCapture');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

/**
 * Hold the microphone while the app is backgrounded.
 *
 * Must be called from the foreground, before or as recording starts. A no-op on
 * every platform but Android.
 *
 * @returns whether a service is now holding the microphone. `false` on iOS and
 *   web is expected and not a failure — it means nothing was needed.
 */
export function startBackgroundCapture(title: string, body: string): boolean {
  const module = getNativeModule();
  if (!module) return false;
  module.startCaptureService(title, body);
  return true;
}

/** Release it. Safe to call when nothing is running. */
export function stopBackgroundCapture(): void {
  getNativeModule()?.stopCaptureService();
}

/** Whether the service is currently holding the microphone. */
export function isBackgroundCaptureRunning(): boolean {
  return getNativeModule()?.isCaptureServiceRunning() ?? false;
}
