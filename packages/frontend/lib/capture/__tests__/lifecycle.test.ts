import { describe, expect, it } from 'vitest';

import {
  canTransitionCapture,
  canTransitionGeneration,
  canTransitionTranscription,
  isCapturing,
  isRecordingSafe,
  isSettled,
  legacyStateFromLifecycle,
  lifecycleFromLegacyState,
  type CaptureLifecycle,
} from '@/lib/capture/lifecycle';

function lifecycle(over: Partial<CaptureLifecycle> = {}): CaptureLifecycle {
  return {
    capture: 'stopped',
    transcription: 'complete',
    generation: 'complete',
    enhancement: 'complete',
    ...over,
  };
}

describe('the microphone', () => {
  it('cannot be reopened once it is closed', () => {
    // A process that stopped recording did not keep the device; resuming means
    // a new capture, not a state change on the old one.
    expect(canTransitionCapture('stopped', 'recording')).toBe(false);
    expect(canTransitionCapture('interrupted', 'recording')).toBe(false);
    expect(canTransitionCapture('recording', 'stopping')).toBe(true);
  });

  it('can be interrupted before it ever reached recording', () => {
    // A process killed during startup leaves a row claiming `starting`, and
    // nothing else will ever move it.
    expect(canTransitionCapture('starting', 'interrupted')).toBe(true);
  });

  it('knows when the device is in use', () => {
    expect(isCapturing('starting')).toBe(true);
    expect(isCapturing('stopping')).toBe(true);
    expect(isCapturing('stopped')).toBe(false);
    expect(isCapturing('interrupted')).toBe(false);
  });
});

describe('transcription and generation are not the microphone', () => {
  it('lets a finished transcript be redone', () => {
    // A better model arrives, or the user corrects the language. Neither is a
    // failure and neither reopens the microphone.
    expect(canTransitionTranscription('complete', 'pending')).toBe(true);
    expect(canTransitionGeneration('complete', 'finalizing')).toBe(true);
  });

  it('lets a failure be retried', () => {
    expect(canTransitionTranscription('failed', 'pending')).toBe(true);
    expect(canTransitionGeneration('failed', 'finalizing')).toBe(true);
  });

  it('does not let generation skip straight to complete', () => {
    // "Notes ready" has to be something that was produced, not a state somebody
    // set because nothing went wrong.
    expect(canTransitionGeneration('idle', 'complete')).toBe(false);
    expect(canTransitionGeneration('finalizing', 'complete')).toBe(true);
  });

  it('finishes a live transcript through its tail', () => {
    // The last slice lands during stop, and it is the one carrying whatever was
    // agreed at the end of the meeting.
    expect(canTransitionTranscription('live', 'pending')).toBe(true);
  });
});

describe('what the UI asks', () => {
  it('is settled only when nothing is still working', () => {
    expect(isSettled(lifecycle())).toBe(true);
    expect(isSettled(lifecycle({ capture: 'recording', transcription: 'live', generation: 'live' }))).toBe(
      false,
    );
    expect(isSettled(lifecycle({ generation: 'finalizing' }))).toBe(false);
    expect(isSettled(lifecycle({ transcription: 'running' }))).toBe(false);
  });

  it('is settled for a failure, which is an outcome and not a wait', () => {
    expect(isSettled(lifecycle({ capture: 'failed', transcription: 'failed', generation: 'idle' }))).toBe(
      true,
    );
  });

  it('says the recording is safe when the audio made it to disk', () => {
    // The line the failure copy turns on: "the recording is safe, but Noted
    // could not finish the notes" is only honest if somebody checked.
    expect(isRecordingSafe(lifecycle({ capture: 'stopped', generation: 'failed' }))).toBe(true);
    expect(isRecordingSafe(lifecycle({ capture: 'interrupted' }))).toBe(true);
    expect(isRecordingSafe(lifecycle({ capture: 'failed' }))).toBe(false);
    expect(isRecordingSafe(lifecycle({ capture: 'recording' }))).toBe(false);
  });
});

describe('the old single enum', () => {
  it('splits each state into the three machines', () => {
    expect(lifecycleFromLegacyState('recording')).toEqual({
      capture: 'recording',
      transcription: 'live',
      generation: 'live',
      enhancement: 'pending',
    });
    expect(lifecycleFromLegacyState('interrupted')).toEqual({
      capture: 'interrupted',
      transcription: 'pending',
      generation: 'idle',
      enhancement: 'pending',
    });
    expect(lifecycleFromLegacyState('complete')).toEqual({
      capture: 'stopped',
      transcription: 'complete',
      generation: 'complete',
      enhancement: 'complete',
    });
  });

  it('round-trips every state it can', () => {
    // Not every one: `transcribing` and a stopped-but-unfinished capture are the
    // same old value, which is precisely why one column was not enough.
    for (const state of ['recording', 'interrupted', 'complete', 'failed'] as const) {
      expect(legacyStateFromLifecycle(lifecycleFromLegacyState(state))).toBe(state);
    }
    expect(legacyStateFromLifecycle(lifecycleFromLegacyState('transcribing'))).toBe('transcribing');
  });

  it('reads a half-finished capture as still working, not as done', () => {
    // The direction that matters: an older build believing the note is finished
    // stops offering to retry it.
    expect(
      legacyStateFromLifecycle(lifecycle({ transcription: 'complete', generation: 'finalizing' })),
    ).toBe('transcribing');
  });

  it('reports a failed transcript as failed even though the microphone was fine', () => {
    expect(legacyStateFromLifecycle(lifecycle({ transcription: 'failed' }))).toBe('failed');
  });
});
