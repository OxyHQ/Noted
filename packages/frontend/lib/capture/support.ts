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
 * Whether a recording made by the `expo-audio` engine survives the app closing.
 *
 * Narrower than its name once suggested, and the narrowing matters. Native writes
 * the audio into the app's document directory. On web `expo-audio` hands back a
 * blob URL, which lives only as long as the page — so a capture from THAT engine
 * is real while the tab is open and gone after a reload.
 *
 * The live engine is a different story now: it writes chunks to durable browser
 * storage as they arrive (`lib/audio/`), so a browser recording made that way
 * does survive a reload. Anything asking "can I promise recovery?" has to know
 * which engine recorded it, which is why this is only consulted inside
 * `use-recorder.ts`.
 */
export function isCaptureDurable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Whether this device can record anything other than its own microphone.
 *
 * Nowhere, today — and saying so is the point. A browser's `getUserMedia` gives
 * the microphone, so the other people in a call are simply not in the audio when
 * the user is wearing headphones. That is a limitation worth stating next to the
 * recording rather than leaving somebody to discover it afterwards from a note
 * with half a meeting in it.
 *
 * A desktop adapter is what changes this answer, and that is a later phase of the
 * capture epic rather than something a browser workaround can fake.
 */
export function capturesSystemAudio(): boolean {
  return false;
}
