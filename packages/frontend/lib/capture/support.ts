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
 * Whether a recording can become a note on this device.
 *
 * True everywhere now, by two different routes: whisper.cpp on a phone, and an
 * ONNX build of the same model in the browser. What differs is WHEN — a phone
 * transcribes while recording, a browser once the recording stops — and that
 * difference belongs to the engines, not here.
 */
export function isTranscriptionSupported(): boolean {
  return true;
}

/**
 * Whether this device downloads and stores model weights itself.
 *
 * A separate question from transcription, and it took a crash to make the
 * distinction: on web the model is fetched and cached by transformers.js, there
 * is no file system to put weights in, and `expo-file-system` throws on
 * construction rather than reporting absence. So anything that touches stored
 * weights — the download screen, the size on disk, the delete button — asks this
 * rather than assuming that "can transcribe" implies "has somewhere to put a
 * model".
 */
export function hasDownloadableModels(): boolean {
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
