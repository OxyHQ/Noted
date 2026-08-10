/**
 * What a recording's state looks like to the person who made it.
 *
 * Three machines describe a capture — the microphone, the transcript, the note —
 * and a screen needs one line and, sometimes, one button. Deriving that in a
 * component means deriving it in every component that shows it, and the three
 * that matter would each be subtly different.
 *
 * The copy this produces is the issue's, near enough verbatim, because the
 * wording is the feature:
 *
 * > Recording saved
 * > Finalizing transcript…
 * > Organizing notes…
 * > Notes ready
 *
 * and, when it goes wrong:
 *
 * > The recording is safe, but Noted could not finish the notes. [Retry]
 *
 * That sentence is only honest if somebody checked, which is why `recordingSafe`
 * is computed from the capture status rather than assumed.
 */

import { isCapturing, isRecordingSafe, type CaptureLifecycle } from '@/lib/capture/lifecycle';

export type CaptureStatusKind =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'organizing'
  | 'ready'
  | 'interrupted'
  | 'transcriptFailed'
  | 'notesFailed'
  | 'failed';

/** What a Retry button would actually retry. */
export type CaptureRetry = 'transcript' | 'notes' | null;

export interface CaptureStatusView {
  kind: CaptureStatusKind;
  /** The i18n key for the line the user reads. */
  messageKey: string;
  retry: CaptureRetry;
  /** Whether the audio made it to storage, whatever else went wrong. */
  recordingSafe: boolean;
  /** Whether anything is still working on this capture. */
  busy: boolean;
}

function view(
  kind: CaptureStatusKind,
  lifecycle: CaptureLifecycle,
  options: { retry?: CaptureRetry; busy?: boolean } = {},
): CaptureStatusView {
  return {
    kind,
    messageKey: `capture.status.${kind}`,
    retry: options.retry ?? null,
    recordingSafe: isRecordingSafe(lifecycle),
    busy: options.busy ?? false,
  };
}

/**
 * The one line to show, and whether to offer a retry.
 *
 * Failures are read BEFORE progress, and that order is the whole point: a
 * transcript that finished and a note that then failed would otherwise report
 * "Notes ready", which is the one thing the user must not be told. A capture that
 * never reached storage is read before either, because there is nothing to retry
 * against.
 */
export function captureStatus(lifecycle: CaptureLifecycle): CaptureStatusView {
  if (lifecycle.capture === 'failed') return view('failed', lifecycle);

  if (isCapturing(lifecycle.capture)) return view('recording', lifecycle, { busy: true });

  // The process died holding the microphone. The audio on disk is real, and
  // transcribing it is exactly what recovery offers.
  if (lifecycle.capture === 'interrupted') {
    return view('interrupted', lifecycle, { retry: 'transcript' });
  }

  if (lifecycle.transcription === 'failed') {
    return view('transcriptFailed', lifecycle, { retry: 'transcript' });
  }
  if (lifecycle.generation === 'failed') {
    return view('notesFailed', lifecycle, { retry: 'notes' });
  }

  if (lifecycle.transcription === 'pending' || lifecycle.transcription === 'running') {
    return view('transcribing', lifecycle, { busy: true });
  }
  if (lifecycle.generation === 'finalizing') {
    return view('organizing', lifecycle, { busy: true });
  }
  if (lifecycle.transcription === 'complete' && lifecycle.generation === 'complete') {
    return view('ready', lifecycle);
  }

  return view('idle', lifecycle);
}

/** Every message key this module can produce, so a locale can be checked against it. */
export const CAPTURE_STATUS_KEYS: readonly string[] = [
  'idle',
  'recording',
  'transcribing',
  'organizing',
  'ready',
  'interrupted',
  'transcriptFailed',
  'notesFailed',
  'failed',
].map((kind) => `capture.status.${kind}`);
