/**
 * That the recorders actually gave up ownership.
 *
 * `coordinator.ts` and `queue.ts` are tested thoroughly and in isolation, and
 * they reach neither SQLite nor React — which is what makes them testable and
 * also what leaves exactly one gap: the pure module can be perfect while nothing
 * calls it. Both bugs this epic starts from fell through that gap. The recorders
 * were the same product logic written twice, and a rule enforced in one copy is
 * not enforced.
 *
 * These are source checks, which is crude, and they are scoped to named files and
 * named symbols rather than pretending to be a general rule. Each assertion below
 * was mutation-tested by putting the old code back and confirming this file is
 * the one that goes red.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;

const read = (path: string): string => readFileSync(join(HERE, '..', '..', path), 'utf8');

const NATIVE = read('capture/use-realtime-recorder.native.ts');
const WEB = read('capture/use-realtime-recorder.web.ts');
const COORDINATOR = read('capture/coordinator.ts');
const REALTIME_NATIVE = read('stt/realtime.native.ts');
const REALTIME_WEB = read('stt/realtime.web.ts');
const ENGINE_NATIVE = read('stt/engine.native.ts');
const ENGINE_WEB = read('stt/engine.web.ts');

const RECORDERS: readonly (readonly [string, string])[] = [
  ['native', NATIVE],
  ['web', WEB],
];

/**
 * The files that BUILD segments.
 *
 * `realtime.web.ts` is not among them: it hands its samples to `engine.web.ts`,
 * which is where its segments are made. It is checked separately, for the thing
 * it does own — telling the engine which slice this is.
 */
const RECOGNISERS: readonly (readonly [string, string])[] = [
  ['realtime.native', REALTIME_NATIVE],
  ['engine.native', ENGINE_NATIVE],
  ['engine.web', ENGINE_WEB],
];

describe('the files this checks', () => {
  it('are the files it thinks they are', () => {
    // Without this, a renamed or moved file makes every assertion below pass by
    // finding nothing at all.
    for (const [name, source] of RECORDERS) {
      expect(source, name).toContain('export function useRealtimeRecorder');
    }
    for (const [name, source] of RECOGNISERS) {
      expect(source, name).toContain('captures-repo');
    }
    expect(REALTIME_WEB).toContain('transcribeSamples(');
    expect(COORDINATOR).toContain('export class CaptureCoordinator');
  });
});

describe('the recorders', () => {
  it('hand transcript changes to the coordinator instead of starting their own rebuild', () => {
    // The race: `void restructureNote(...)` per callback, nothing tracking them,
    // and whichever finished last won — which is not whichever read the most.
    for (const [name, source] of RECORDERS) {
      expect(source, name).toContain('coordinator.transcriptChanged()');
      expect(source, name).not.toContain('restructureNote(');
    }
  });

  it('does not wait for the model inside stop', () => {
    // Pressing stop appeared to hang. The microphone was already closed and the
    // audio already written; the button was waiting for a model to load.
    for (const [name, source] of RECORDERS) {
      expect(source, name).not.toContain('enhanceNote(');
      expect(source, name).toContain('markStopped(');
    }
  });

  it('reports the lifecycle through the coordinator, not by writing states itself', () => {
    // Two writers of one row disagree, which is how a capture ended up showing
    // `saved` on screen while its row still said `transcribing`.
    for (const [name, source] of RECORDERS) {
      expect(source, name).toContain('createLiveCoordinator(');
      expect(source, name).not.toContain('finishCapture(');
      expect(source, name).not.toContain('failCapture(');
    }
  });
});

describe('the coordinator', () => {
  it('is the only thing that builds a processing queue', () => {
    // One queue per capture is the guarantee. A second construction site is a
    // second queue, and two queues are the race with extra steps.
    const built = [NATIVE, WEB, COORDINATOR, read('capture/live-coordinator.ts')].filter((source) =>
      source.includes('new CaptureProcessingQueue('),
    );
    expect(built).toHaveLength(1);
    expect(COORDINATOR).toContain('new CaptureProcessingQueue(');
  });

  it('starts finalisation without awaiting it', () => {
    // `markStopped` resolves when the recording is safe. Awaiting the final pass
    // here is exactly the bug it was extracted to fix.
    expect(COORDINATOR).toMatch(/this\.beginFinalization\(\);/);
    expect(COORDINATOR).not.toMatch(/await this\.beginFinalization\(\)/);
  });
});

describe('the browser’s audio', () => {
  const AUDIO_STORE = read('audio/store.ts');
  const NOTES_REPO = read('db/notes-repo.ts');

  it('reads the files it thinks it does', () => {
    expect(AUDIO_STORE).toContain('export async function createPlaybackUrl');
    expect(NOTES_REPO).toContain('export async function deleteNote');
  });

  it('is written as it arrives, not accumulated until stop', () => {
    // An hour-long meeting used to sit in memory in a backgrounded tab. A
    // timeslice is what makes the recorder hand audio over DURING the recording;
    // without one `ondataavailable` fires once, at the end, with everything.
    expect(REALTIME_WEB).toContain('recorder.start(CHUNK_MS)');
    expect(REALTIME_WEB).not.toContain('recordedChunks');
  });

  it('stores a durable reference rather than a handle', () => {
    // A row holding a `blob:` URL looked valid and resolved to nothing after a
    // reload, because the object it named died with the page.
    expect(REALTIME_WEB).toContain('audioRef(options.captureId)');
    expect(REALTIME_WEB).not.toContain('URL.createObjectURL');
  });

  it('mints and revokes playback handles in one place', () => {
    // An object URL pins its blob for the lifetime of the document, so a screen
    // that mints one per render leaks a recording per render.
    expect(AUDIO_STORE).toContain('URL.createObjectURL');
    expect(AUDIO_STORE).toContain('URL.revokeObjectURL');
  });

  it('is deleted along with the note that pointed at it', () => {
    // A note is the only thing that points at its recordings; tombstoning it
    // without this leaves the audio and the transcript of a deleted meeting on
    // the device with nothing left to find them by.
    expect(NOTES_REPO).toContain('deleteNoteRecordings(');
  });
});

describe('the recognisers', () => {
  it('derive a segment id from its position rather than minting one', () => {
    // A minted id means `INSERT OR REPLACE` has nothing to replace, so each
    // re-emission of a filling slice is kept as its own row.
    for (const [name, source] of RECOGNISERS) {
      expect(source, name).toContain('makeSegment(');
      expect(source, name).not.toContain('newNoteId');
    }
  });

  it('tell the engine which slice is being settled', () => {
    // The browser's segments are built inside `engine.web.ts`, so what this file
    // owns is the number they are named after. Taken when the span is CUT, not
    // when its transcription happens to finish — the two are seconds apart on a
    // slow machine, and by then the counter has moved.
    expect(REALTIME_WEB).toContain('commit(slice, offset, sliceIndex)');
    expect(REALTIME_WEB).toMatch(/sliceIndex \+= 1/);
  });

  it('upsert their segments instead of appending them', () => {
    for (const [name, source] of [
      ['realtime.native', REALTIME_NATIVE],
      ['realtime.web', REALTIME_WEB],
    ] as const) {
      expect(source, name).toContain('upsertSegments(');
      expect(source, name).not.toContain('appendSegments(');
    }
  });
});
