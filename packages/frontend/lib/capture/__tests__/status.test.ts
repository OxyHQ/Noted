import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { captureStatus, CAPTURE_STATUS_KEYS } from '@/lib/capture/status';
import type { CaptureLifecycle } from '@/lib/capture/lifecycle';

function lifecycle(over: Partial<CaptureLifecycle> = {}): CaptureLifecycle {
  return {
    capture: 'stopped',
    transcription: 'complete',
    generation: 'complete',
    enhancement: 'complete',
    ...over,
  };
}

describe('what the user is told', () => {
  it('says the notes are ready only when they are', () => {
    expect(captureStatus(lifecycle()).kind).toBe('ready');
  });

  it('walks through the honest states of a recording that goes well', () => {
    expect(captureStatus(lifecycle({ capture: 'recording', transcription: 'live', generation: 'live' })).kind).toBe(
      'recording',
    );
    expect(captureStatus(lifecycle({ transcription: 'running', generation: 'idle' })).kind).toBe(
      'transcribing',
    );
    expect(captureStatus(lifecycle({ generation: 'finalizing' })).kind).toBe('organizing');
    expect(captureStatus(lifecycle()).kind).toBe('ready');
  });

  it('never says ready when the notes failed after the transcript finished', () => {
    // The one thing the user must not be told. Failures are read before
    // progress precisely so a finished transcript cannot mask a failed note.
    const status = captureStatus(lifecycle({ generation: 'failed' }));
    expect(status.kind).toBe('notesFailed');
    expect(status.retry).toBe('notes');
  });

  it('offers to retry the transcript when that is what failed', () => {
    const status = captureStatus(lifecycle({ transcription: 'failed', generation: 'idle' }));
    expect(status.kind).toBe('transcriptFailed');
    expect(status.retry).toBe('transcript');
  });

  it('offers a recording the process died in the middle of', () => {
    const status = captureStatus(
      lifecycle({ capture: 'interrupted', transcription: 'pending', generation: 'idle' }),
    );
    expect(status.kind).toBe('interrupted');
    expect(status.retry).toBe('transcript');
  });

  it('offers nothing to retry when the recording itself never happened', () => {
    const status = captureStatus(
      lifecycle({ capture: 'failed', transcription: 'failed', generation: 'idle' }),
    );
    expect(status.kind).toBe('failed');
    expect(status.retry).toBeNull();
  });
});

describe('"the recording is safe"', () => {
  it('is only claimed when the audio actually reached storage', () => {
    // The sentence is only honest if somebody checked.
    expect(captureStatus(lifecycle({ generation: 'failed' })).recordingSafe).toBe(true);
    expect(
      captureStatus(lifecycle({ capture: 'interrupted', transcription: 'pending' })).recordingSafe,
    ).toBe(true);
    expect(captureStatus(lifecycle({ capture: 'failed' })).recordingSafe).toBe(false);
    expect(
      captureStatus(lifecycle({ capture: 'recording', transcription: 'live' })).recordingSafe,
    ).toBe(false);
  });
});

describe('busy', () => {
  it('is true exactly while something is working', () => {
    expect(captureStatus(lifecycle({ capture: 'recording' })).busy).toBe(true);
    expect(captureStatus(lifecycle({ transcription: 'running' })).busy).toBe(true);
    expect(captureStatus(lifecycle({ generation: 'finalizing' })).busy).toBe(true);
    expect(captureStatus(lifecycle()).busy).toBe(false);
    expect(captureStatus(lifecycle({ generation: 'failed' })).busy).toBe(false);
  });
});

describe('the copy', () => {
  const locales = ['en', 'es'] as const;

  function read(locale: string): Record<string, unknown> {
    const path = join(import.meta.dirname, '../../i18n/locales', `${locale}.json`);
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  }

  function lookup(bundle: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => {
      if (typeof node !== 'object' || node === null) return undefined;
      return (node as Record<string, unknown>)[part];
    }, bundle);
  }

  it('exists in every locale, for every state this can report', () => {
    // A missing key renders as the key itself — "capture.status.organizing" in
    // the middle of a note screen — and nothing else in the app would catch it.
    expect(CAPTURE_STATUS_KEYS.length).toBeGreaterThan(5);
    for (const locale of locales) {
      const bundle = read(locale);
      for (const key of CAPTURE_STATUS_KEYS) {
        expect(typeof lookup(bundle, key), `${locale} ${key}`).toBe('string');
      }
    }
  });

  it('reads a real value, so a broken lookup cannot pass', () => {
    expect(lookup(read('en'), 'capture.status.ready')).toBeTypeOf('string');
    expect(lookup(read('en'), 'capture.status.definitelyNotAKey')).toBeUndefined();
  });
});
