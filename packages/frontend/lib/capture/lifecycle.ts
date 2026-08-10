/**
 * Three questions, three answers.
 *
 * A capture used to have one `state`, and one enum cannot answer "is the
 * microphone open?", "do we have the words yet?" and "is the note written?" at
 * the same time — so it answered whichever the last writer cared about. That is
 * the mismatch behind a recording that says `saved` on screen while its row still
 * says `transcribing`, and behind a stop button that appears to hang because it is
 * waiting for a model to finish something the microphone stopped needing minutes
 * ago.
 *
 * Split apart, each machine is small enough to be obviously right, and the states
 * that matter to the user — *the recording is safe*, *the notes are still being
 * organised* — become things the UI can read rather than infer.
 */

/** The microphone. Nothing else. */
export type CaptureStatus =
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'stopped'
  | 'interrupted'
  | 'failed';

/** Turning audio into words. */
export type TranscriptionStatus = 'idle' | 'live' | 'pending' | 'running' | 'complete' | 'failed';

/**
 * Turning words into the note that always exists.
 *
 * The BASELINE note — the one the rule-based pass writes, which needs nothing
 * downloaded and cannot be refused by a model. `complete` here means the user has
 * a note, full stop.
 */
export type NoteGenerationStatus = 'idle' | 'live' | 'finalizing' | 'complete' | 'failed';

/**
 * Making that note better with a model.
 *
 * Tracked separately, and separating it is the whole point. Conflated with
 * generation, a model that failed to load reported "Noted could not finish the
 * notes" over a finished note — the most alarming sentence in the app, about a
 * document sitting on the user's screen. `unsupported` is not a failure: a device
 * with no model that can run is a device whose baseline note is the final answer.
 */
export type EnhancementStatus =
  | 'unsupported'
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed';

export interface CaptureLifecycle {
  capture: CaptureStatus;
  transcription: TranscriptionStatus;
  generation: NoteGenerationStatus;
  enhancement: EnhancementStatus;
}

/**
 * Which moves each machine allows.
 *
 * `interrupted` is reachable from `starting` and `recording` only, and nothing
 * leaves it except a retry that starts a new capture: a process that died holding
 * the microphone cannot be resumed, only recovered from.
 */
const CAPTURE_TRANSITIONS: Readonly<Record<CaptureStatus, readonly CaptureStatus[]>> = {
  starting: ['recording', 'stopping', 'interrupted', 'failed'],
  recording: ['stopping', 'stopped', 'interrupted', 'failed'],
  stopping: ['stopped', 'failed'],
  stopped: [],
  interrupted: [],
  failed: [],
};

const TRANSCRIPTION_TRANSITIONS: Readonly<
  Record<TranscriptionStatus, readonly TranscriptionStatus[]>
> = {
  // `running` directly, and not only through `pending`: a recording transcribed
  // after the fact starts the moment the file is closed, with nothing queued.
  idle: ['live', 'pending', 'running', 'failed'],
  // Live transcription still has a tail to finish once the microphone closes,
  // which is why it goes to `pending` rather than straight to `complete`.
  live: ['pending', 'running', 'complete', 'failed'],
  pending: ['running', 'failed'],
  running: ['complete', 'failed'],
  // A finished transcript can be redone — a better model arrives, or the user
  // corrects the language — so this is not terminal.
  complete: ['pending'],
  failed: ['pending'],
};

const GENERATION_TRANSITIONS: Readonly<
  Record<NoteGenerationStatus, readonly NoteGenerationStatus[]>
> = {
  idle: ['live', 'finalizing', 'failed'],
  live: ['finalizing', 'failed'],
  finalizing: ['complete', 'failed'],
  // Regeneration is a first-class action: a new profile, a better model, a retry.
  complete: ['finalizing'],
  failed: ['finalizing'],
};

export function canTransitionCapture(from: CaptureStatus, to: CaptureStatus): boolean {
  return from === to || CAPTURE_TRANSITIONS[from].includes(to);
}

export function canTransitionTranscription(
  from: TranscriptionStatus,
  to: TranscriptionStatus,
): boolean {
  return from === to || TRANSCRIPTION_TRANSITIONS[from].includes(to);
}

const ENHANCEMENT_TRANSITIONS: Readonly<Record<EnhancementStatus, readonly EnhancementStatus[]>> = {
  // A device can discover it cannot run a model at any point before it tries.
  pending: ['running', 'unsupported', 'failed'],
  running: ['complete', 'failed', 'unsupported'],
  // Both are retryable: a better model arrives, a download finishes, the user
  // asks again. Neither is terminal.
  complete: ['running'],
  failed: ['running'],
  unsupported: ['pending', 'running'],
};

export function canTransitionEnhancement(from: EnhancementStatus, to: EnhancementStatus): boolean {
  return from === to || ENHANCEMENT_TRANSITIONS[from].includes(to);
}

export function canTransitionGeneration(
  from: NoteGenerationStatus,
  to: NoteGenerationStatus,
): boolean {
  return from === to || GENERATION_TRANSITIONS[from].includes(to);
}

/** Whether the microphone is, or is about to be, open. */
export function isCapturing(status: CaptureStatus): boolean {
  return status === 'starting' || status === 'recording' || status === 'stopping';
}

/**
 * Whether anything is still working on this capture.
 *
 * What the UI asks to decide between "Notes ready" and a progress line, and what
 * recovery asks to decide whether a row needs picking up after a cold start.
 */
export function isSettled(lifecycle: CaptureLifecycle): boolean {
  return (
    !isCapturing(lifecycle.capture) &&
    lifecycle.transcription !== 'pending' &&
    lifecycle.transcription !== 'running' &&
    lifecycle.transcription !== 'live' &&
    lifecycle.generation !== 'finalizing' &&
    lifecycle.generation !== 'live' &&
    lifecycle.enhancement !== 'running'
  );
}

/**
 * Whether the audio is safe on disk, whatever else went wrong.
 *
 * The distinction the failure copy turns on: *"the recording is safe, but Noted
 * could not finish the notes"* is only honest if somebody checked, and this is
 * that check.
 */
export function isRecordingSafe(lifecycle: CaptureLifecycle): boolean {
  return lifecycle.capture === 'stopped' || lifecycle.capture === 'interrupted';
}

/* ── The old single enum ───────────────────────────────────────── */

/**
 * The five-state column captures were stored in.
 *
 * Kept for as long as rows written by an older build can still be read. Both
 * directions are here so a row can be understood whichever build wrote it.
 */
export type LegacyCaptureState =
  | 'recording'
  | 'interrupted'
  | 'transcribing'
  | 'complete'
  | 'failed';

export function lifecycleFromLegacyState(state: LegacyCaptureState): CaptureLifecycle {
  switch (state) {
    case 'recording':
      return {
        capture: 'recording',
        transcription: 'live',
        generation: 'live',
        enhancement: 'pending',
      };
    case 'interrupted':
      // The audio is on disk and nothing is working on it: exactly the row the
      // recovery affordance exists to offer.
      return {
        capture: 'interrupted',
        transcription: 'pending',
        generation: 'idle',
        enhancement: 'pending',
      };
    case 'transcribing':
      return {
        capture: 'stopped',
        transcription: 'running',
        generation: 'idle',
        enhancement: 'pending',
      };
    case 'complete':
      return {
        capture: 'stopped',
        transcription: 'complete',
        generation: 'complete',
        enhancement: 'complete',
      };
    case 'failed':
      return {
        capture: 'failed',
        transcription: 'failed',
        generation: 'idle',
        enhancement: 'pending',
      };
  }
}

/**
 * The nearest old-enum answer for a lifecycle.
 *
 * Lossy by construction — three machines do not fit in one column — so it is
 * ordered by what an older build would do least harm believing: anything still
 * running reads as work in progress, and only a genuinely finished capture reads
 * as `complete`.
 */
export function legacyStateFromLifecycle(lifecycle: CaptureLifecycle): LegacyCaptureState {
  if (lifecycle.capture === 'failed') return 'failed';
  if (lifecycle.capture === 'interrupted') return 'interrupted';
  if (isCapturing(lifecycle.capture)) return 'recording';
  // Deliberately does NOT consult `enhancement`: an old build reading `failed`
  // would offer to redo everything over an optional improvement that did not
  // happen, about a note that exists.
  if (lifecycle.transcription === 'failed' || lifecycle.generation === 'failed') return 'failed';
  if (lifecycle.transcription === 'complete' && lifecycle.generation === 'complete') {
    return 'complete';
  }
  return 'transcribing';
}
