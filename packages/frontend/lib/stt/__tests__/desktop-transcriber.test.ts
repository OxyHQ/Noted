import { describe, expect, it, vi } from 'vitest';

// The transcriber builds segments with the capture repository's helper, which sits
// on the local store; none of that is exercised here.
vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => null,
  subscribe: vi.fn(),
}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@/lib/models/weights', () => ({
  download: vi.fn(),
  isPresent: vi.fn(),
  remove: vi.fn(),
  statesOf: vi.fn(),
  weightsFile: vi.fn(),
}));

import type { Invoke } from '@/lib/db/desktop-driver';
import {
  DESKTOP_DEFAULT_MODEL,
  DESKTOP_MODEL_FILES,
  DesktopModelMissingError,
  SLICE_SECONDS,
  createDesktopTranscriber,
  encodeSamples,
  whisperLanguage,
} from '@/lib/stt/desktop-transcriber';
import { DEFAULT_STT_MODEL, STT_MODELS } from '@/lib/stt/models';

type Call = { command: string; args: Record<string, unknown> };

function fakeRust(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    const result = answer({ command, args });
    if (result instanceof Error) throw result;
    return result as T;
  };
  return { invoke, calls };
}

const decode = (b64: unknown) =>
  new Float32Array(new Uint8Array(Buffer.from(String(b64), 'base64')).buffer);

describe("the adapter stays in step with the app's model catalogue", () => {
  it('names the same file for every model', () => {
    for (const id of Object.keys(STT_MODELS) as (keyof typeof STT_MODELS)[]) {
      expect(DESKTOP_MODEL_FILES[id], id).toBe(STT_MODELS[id].filename);
    }
  });

  it('defaults to the same model the app does', () => {
    expect(DESKTOP_DEFAULT_MODEL).toBe(DEFAULT_STT_MODEL);
  });
});

describe('encodeSamples', () => {
  it('writes little-endian float32, which is what Rust decodes', () => {
    // 1.0f is 00 00 80 3F in little-endian.
    expect(encodeSamples(new Float32Array([1]))).toBe('AACAPw==');
  });

  it('round-trips, including a view into the middle of a buffer', () => {
    const buffer = new Float32Array([0.1, -0.25, 0.5, 0.75]);
    const view = buffer.subarray(1, 3);
    expect(Array.from(decode(encodeSamples(view)))).toEqual([-0.25, 0.5]);
  });

  it('copes with more audio than fits in one fromCharCode call', () => {
    const big = new Float32Array(200_000).fill(0.5);
    expect(decode(encodeSamples(big)).length).toBe(200_000);
  });
});

describe('whisperLanguage', () => {
  it('passes auto through, since whisper.cpp really detects the language', () => {
    expect(whisperLanguage('auto')).toBe('auto');
  });

  it('reduces a regional tag to its language', () => {
    expect(whisperLanguage('pt-BR')).toBe('pt');
    expect(whisperLanguage('es_MX')).toBe('es');
    expect(whisperLanguage('EN')).toBe('en');
  });

  it('turns anything that is not a code into auto instead of an error', () => {
    for (const bad of ['', '--version', 'english', 'x', '../x']) {
      expect(whisperLanguage(bad), bad).toBe('auto');
    }
  });
});

describe('transcribe (one slice)', () => {
  it('sends the samples, the language and the model FILE, and returns app segments', async () => {
    const { invoke, calls } = fakeRust(() => [
      { text: ' Hello there. ', startMs: 0, endMs: 1200 },
      { text: '[BLANK_AUDIO]', startMs: 1200, endMs: 2000 },
      { text: '   ', startMs: 2000, endMs: 2100 },
      { text: 'Bye.', startMs: 2100, endMs: 3000 },
    ]);
    const transcriber = createDesktopTranscriber(async () => invoke);

    const segments = await transcriber.transcribe(new Float32Array([0.5, 0.5]), {
      captureId: 'cap-1',
      language: 'es-ES',
      offsetMs: 10_000,
      sliceIndex: 2,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('stt_transcribe');
    expect(calls[0].args.language).toBe('es');
    expect(calls[0].args.model).toBe(DESKTOP_MODEL_FILES[DESKTOP_DEFAULT_MODEL]);
    expect(Array.from(decode(calls[0].args.samples))).toEqual([0.5, 0.5]);

    // Blank and non-speech segments are not transcript; the offset is added.
    expect(segments.map((s) => [s.text, s.startMs, s.endMs])).toEqual([
      ['Hello there.', 10_000, 11_200],
      ['Bye.', 12_100, 13_000],
    ]);
    expect(segments.every((s) => s.captureId === 'cap-1' && s.sliceIndex === 2)).toBe(true);
  });

  it('gives a retried slice the same ids, so it lands on the rows it wrote before', async () => {
    const answer = () => [{ text: 'same words', startMs: 0, endMs: 500 }];
    const first = await createDesktopTranscriber(async () => fakeRust(answer).invoke).transcribe(
      new Float32Array(10),
      { captureId: 'cap', language: 'en', sliceIndex: 3 },
    );
    const again = await createDesktopTranscriber(async () => fakeRust(answer).invoke).transcribe(
      new Float32Array(10),
      { captureId: 'cap', language: 'en', sliceIndex: 3 },
    );
    expect(again[0].id).toBe(first[0].id);
  });

  it('turns the missing-model reply into its own error, and leaves other failures alone', async () => {
    const missing = createDesktopTranscriber(
      async () => fakeRust(() => new Error('model_missing')).invoke,
    );
    await expect(
      missing.transcribe(new Float32Array(1), { captureId: 'c', language: 'en' }),
    ).rejects.toBeInstanceOf(DesktopModelMissingError);

    const broken = createDesktopTranscriber(
      async () => fakeRust(() => new Error('the transcriber failed (exit status: 1)')).invoke,
    );
    await expect(
      broken.transcribe(new Float32Array(1), { captureId: 'c', language: 'en' }),
    ).rejects.toThrow(/transcriber failed/);
  });
});

describe('transcribeRecording (a whole file)', () => {
  it('cuts the audio into slices and timestamps each from its place in the recording', async () => {
    const perSlice = SLICE_SECONDS * 16_000;
    const { invoke, calls } = fakeRust(() => [{ text: 'words', startMs: 100, endMs: 900 }]);
    const transcriber = createDesktopTranscriber(async () => invoke);
    const delivered: number[] = [];

    // 2.5 slices of audio.
    const segments = await transcriber.transcribeRecording(
      new Float32Array(Math.round(perSlice * 2.5)),
      { captureId: 'cap', language: 'en' },
      (batch) => delivered.push(batch.length),
    );

    expect(calls).toHaveLength(3);
    expect(decode(calls[0].args.samples).length).toBe(perSlice);
    expect(decode(calls[2].args.samples).length).toBe(perSlice / 2);
    expect(segments.map((s) => s.startMs)).toEqual([100, 30_100, 60_100]);
    expect(segments.map((s) => s.sliceIndex)).toEqual([0, 1, 2]);
    expect(delivered).toEqual([1, 1, 1]);
  });

  it('does nothing for no audio, and does not report empty batches', async () => {
    const { invoke, calls } = fakeRust(() => []);
    const onSegments = vi.fn();
    const result = await createDesktopTranscriber(async () => invoke).transcribeRecording(
      new Float32Array(0),
      { captureId: 'cap', language: 'en' },
      onSegments,
    );
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(onSegments).not.toHaveBeenCalled();
  });

  it('stops at the first slice that fails rather than skipping a hole into the transcript', async () => {
    const { invoke, calls } = fakeRust(({ args }) =>
      calls.length === 2
        ? new Error('boom')
        : [{ text: String(args.language), startMs: 0, endMs: 1 }],
    );
    const perSlice = SLICE_SECONDS * 16_000;
    await expect(
      createDesktopTranscriber(async () => invoke).transcribeRecording(
        new Float32Array(perSlice * 3),
        {
          captureId: 'cap',
          language: 'en',
        },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toHaveLength(2);
  });
});
