/**
 * What this device can do with a recording.
 *
 * Two separate questions, because the answers differ: every platform can RECORD
 * (`expo-audio` uses `MediaRecorder` on web and hands back a blob URL), but only
 * a native build can TRANSCRIBE, since whisper.cpp is a native library.
 *
 * Keeping them apart is what stops the app from hiding a working feature behind
 * a missing one — which is exactly what an earlier version of this file did.
 */

import { Platform } from 'react-native';

/** Recording works everywhere `expo-audio` does, which is everywhere. */
export function isCaptureSupported(): boolean {
  return true;
}

/**
 * Whether the recording can become a note on this device.
 *
 * Native only: transcription runs on whisper.cpp, a native library. A browser
 * needs a different engine entirely (an ONNX build in a worker), which is its
 * own piece of work — so a web recording is kept as audio until that exists,
 * rather than being refused.
 */
export function isTranscriptionSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Whether recordings survive the app being closed.
 *
 * Native writes the audio into the app's document directory. On web the recorder
 * hands back a blob URL, which lives only as long as the page — so a capture is
 * real while the tab is open and gone after a reload. Worth knowing before
 * promising recovery.
 */
export function isCaptureDurable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
