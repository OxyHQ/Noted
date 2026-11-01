import { expect, it, vi } from 'vitest';
import { RealtimeTranscriber } from 'whisper.rn/realtime-transcription/RealtimeTranscriber';
import { WavFileWriter } from 'whisper.rn/utils/WavFileWriter';

it('documents that an output path without fs does not create a writer', async () => {
  const audioStream = {
    onData() {},
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const transcriber = new RealtimeTranscriber(
    { whisperContext: {} as never, audioStream: audioStream as never },
    { audioOutputPath: '/recording.wav' },
  );
  await transcriber.start();
  expect((transcriber as unknown as { wavFileWriter: unknown }).wavFileWriter).toBeNull();
});

it('documents that append failure is swallowed during stop', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  let file = new Uint8Array();
  const fs = {
    async writeFile(_path: string, data: string) {
      file = Uint8Array.from(Buffer.from(data, 'base64'));
    },
    async appendFile() {
      throw new Error('disk full');
    },
    async readFile() {
      return Buffer.from(file).toString('base64');
    },
    async exists() {
      return true;
    },
    async unlink() {},
  };
  const onError = vi.fn();
  const transcriber = new RealtimeTranscriber(
    { whisperContext: {} as never, audioStream: audioStream as never, fs },
    { audioOutputPath: '/recording.wav' },
    { onError },
  );
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await transcriber.start();
    onData({ data: Uint8Array.of(1, 2, 3, 4) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(transcriber.stop()).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
    expect(file).toHaveLength(44);
    expect(warnings).toHaveBeenCalled();
  } finally {
    warnings.mockRestore();
  }
});

it('documents that concurrent built-in appends can duplicate a queued chunk', async () => {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const appends: number[][] = [];
  const fs = {
    async writeFile() {},
    async appendFile(_path: string, data: string) {
      appends.push([...Buffer.from(data, 'base64')]);
      await blocked;
    },
    async readFile() {
      return '';
    },
    async exists() {
      return false;
    },
    async unlink() {},
  };
  const writer = new WavFileWriter(fs, '/capture.wav', {
    sampleRate: 16_000,
    channels: 1,
    bitsPerSample: 16,
  });
  await writer.initialize();
  const first = writer.appendAudioData(Uint8Array.of(1, 2));
  const second = writer.appendAudioData(Uint8Array.of(3, 4));
  expect(appends).toEqual([
    [1, 2],
    [1, 2, 3, 4],
  ]);
  release?.();
  await Promise.all([first, second]);
});

it('documents that stop drops PCM while the source stop is still pending', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let releaseStop: (() => void) | undefined;
  const stopPending = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => stopPending,
  };
  let file = new Uint8Array();
  let appends = 0;
  const fs = {
    async writeFile(_path: string, data: string) {
      file = Uint8Array.from(Buffer.from(data, 'base64'));
    },
    async appendFile(_path: string, data: string) {
      appends++;
      file = Uint8Array.from(Buffer.concat([file, Buffer.from(data, 'base64')]));
    },
    async readFile() {
      return Buffer.from(file).toString('base64');
    },
    async exists() {
      return true;
    },
    async unlink() {},
  };
  const transcriber = new RealtimeTranscriber(
    { whisperContext: {} as never, audioStream: audioStream as never, fs },
    { audioOutputPath: '/recording.wav' },
  );
  await transcriber.start();
  onData({ data: Uint8Array.of(1, 2) });
  await Promise.resolve();
  expect(appends).toBe(1);
  const stopped = transcriber.stop();
  onData({ data: Uint8Array.of(3, 4) });
  await Promise.resolve();
  expect(appends).toBe(1);
  releaseStop?.();
  await stopped;
});

it('delivers final PCM before stopping Whisper when the source drain is awaited first', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let sourceStops = 0;
  let drain: Promise<void> | undefined;
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop() {
      sourceStops++;
      drain ??= Promise.resolve().then(() => onData({ data: Uint8Array.of(3, 4) }));
      return drain;
    },
  };
  let file = new Uint8Array();
  let appends = 0;
  const fs = {
    async writeFile(_path: string, data: string) {
      file = Uint8Array.from(Buffer.from(data, 'base64'));
    },
    async appendFile(_path: string, data: string) {
      appends++;
      file = Uint8Array.from(Buffer.concat([file, Buffer.from(data, 'base64')]));
    },
    async readFile() {
      return Buffer.from(file).toString('base64');
    },
    async exists() {
      return true;
    },
    async unlink() {},
  };
  const transcriber = new RealtimeTranscriber(
    { whisperContext: {} as never, audioStream: audioStream as never, fs },
    { audioOutputPath: '/recording.wav' },
  );
  await transcriber.start();
  await audioStream.stop();
  await transcriber.stop();
  expect(sourceStops).toBe(2);
  expect(appends).toBe(1);
});

it('keeps a source-stop error visible even though Whisper catches it', async () => {
  const sourceError = new Error('native stop failed');
  let stopPromise: Promise<void> | undefined;
  const audioStream = {
    onData() {},
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop() {
      stopPromise ??= Promise.reject(sourceError);
      return stopPromise;
    },
  };
  const onError = vi.fn();
  const transcriber = new RealtimeTranscriber(
    { whisperContext: {} as never, audioStream: audioStream as never },
    {},
    { onError },
  );
  await transcriber.start();
  const stopThroughController = async () => {
    let sourceFailure: unknown;
    try {
      await audioStream.stop();
    } catch (error) {
      sourceFailure = error;
    }
    await transcriber.stop();
    if (sourceFailure) throw sourceFailure;
  };
  await expect(stopThroughController()).rejects.toBe(sourceError);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('native stop failed'));
});

it('documents that Whisper discards a transcription already in flight during stop', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let finish: ((value: { result: string; segments: never[] }) => void) | undefined;
  const transcription = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finish = resolve;
  });
  const transcribeData = vi.fn(() => ({ promise: transcription }));
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const onTranscribe = vi.fn();
  const transcriber = new RealtimeTranscriber(
    { whisperContext: { transcribeData } as never, audioStream: audioStream as never },
    {},
    { onTranscribe },
  );
  await transcriber.start();
  onData({ data: new Uint8Array(6400) });
  expect(transcribeData).toHaveBeenCalledOnce();
  const stopped = transcriber.stop();
  finish?.({ result: 'last words', segments: [] });
  await stopped;
  expect(onTranscribe.mock.calls.filter(([event]) => event.type === 'transcribe')).toHaveLength(0);
});

it('documents that nextSlice resolves before its transcription finishes', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let finish: ((value: { result: string; segments: never[] }) => void) | undefined;
  const transcription = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finish = resolve;
  });
  const transcribeData = vi.fn(() => ({ promise: transcription }));
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const onTranscribe = vi.fn();
  const transcriber = new RealtimeTranscriber(
    { whisperContext: { transcribeData } as never, audioStream: audioStream as never },
    {},
    { onTranscribe },
  );
  await transcriber.start();
  onData({ data: Uint8Array.of(1, 2) });
  await transcriber.nextSlice();
  expect(transcribeData).toHaveBeenCalledOnce();
  expect(onTranscribe.mock.calls.filter(([event]) => event.type === 'transcribe')).toHaveLength(0);
  const stopped = transcriber.stop();
  finish?.({ result: 'last words', segments: [] });
  await stopped;
  expect(onTranscribe.mock.calls.filter(([event]) => event.type === 'transcribe')).toHaveLength(0);
});

it('can wait for the final callback and persistence before stopping in a controlled case', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let finishRealtime: ((value: { result: string; segments: never[] }) => void) | undefined;
  let finishFinal: ((value: { result: string; segments: never[] }) => void) | undefined;
  let finishPersistence: (() => void) | undefined;
  const realtime = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finishRealtime = resolve;
  });
  const final = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finishFinal = resolve;
  });
  const persistence = new Promise<void>((resolve) => {
    finishPersistence = resolve;
  });
  const transcribeData = vi
    .fn()
    .mockReturnValueOnce({ promise: realtime })
    .mockReturnValueOnce({ promise: final });
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  let target = -1;
  let latestSlice = -1;
  let transcribeEvents = 0;
  let latestPersistence = Promise.resolve();
  let resolveBarrier: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    resolveBarrier = resolve;
  });
  const transcriber = new RealtimeTranscriber(
    { whisperContext: { transcribeData } as never, audioStream: audioStream as never },
    {},
    {
      onTranscribe(event) {
        if (event.type !== 'transcribe') return;
        latestSlice = event.sliceIndex ?? -1;
        transcribeEvents++;
        latestPersistence = transcribeEvents === 2 ? persistence : Promise.resolve();
      },
      onSliceTranscriptionStabilized() {
        if (latestSlice === target) void latestPersistence.then(() => resolveBarrier?.());
      },
    },
  );
  await transcriber.start();
  onData({ data: new Uint8Array(6400) });
  expect(transcribeData).toHaveBeenCalledOnce();
  target = transcriber.getStatistics().sliceStats.currentSliceIndex;
  await transcriber.nextSlice();
  let barrierDone = false;
  void barrier.then(() => {
    barrierDone = true;
  });
  finishRealtime?.({ result: 'partial', segments: [] });
  await vi.waitFor(() => expect(transcribeData).toHaveBeenCalledTimes(2));
  expect(barrierDone).toBe(false);
  finishFinal?.({ result: 'final', segments: [] });
  await vi.waitFor(() => expect(transcribeEvents).toBe(2));
  expect(barrierDone).toBe(false);
  finishPersistence?.();
  await barrier;
  await transcriber.stop();
  expect(barrierDone).toBe(true);
});

it('shows no stabilization callback for an empty forced slice', async () => {
  const audioStream = {
    onData() {},
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const onSliceTranscriptionStabilized = vi.fn();
  const transcribeData = vi.fn();
  const transcriber = new RealtimeTranscriber(
    { whisperContext: { transcribeData } as never, audioStream: audioStream as never },
    {},
    { onSliceTranscriptionStabilized },
  );
  await transcriber.start();
  await transcriber.nextSlice();
  expect(transcribeData).not.toHaveBeenCalled();
  expect(onSliceTranscriptionStabilized).not.toHaveBeenCalled();
  await transcriber.stop();
});

it('reports a failed final transcription without a stabilization callback', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const onError = vi.fn();
  const onSliceTranscriptionStabilized = vi.fn();
  const transcriber = new RealtimeTranscriber(
    {
      whisperContext: {
        transcribeData: () => ({ promise: Promise.reject(new Error('model failed')) }),
      } as never,
      audioStream: audioStream as never,
    },
    {},
    { onError, onSliceTranscriptionStabilized },
  );
  await transcriber.start();
  onData({ data: Uint8Array.of(1, 2) });
  await transcriber.nextSlice();
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('model failed')),
  );
  expect(onSliceTranscriptionStabilized).not.toHaveBeenCalled();
  await transcriber.stop();
});

it('shows simultaneous forced slices do not each receive a final callback', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let finish: ((value: { result: string; segments: never[] }) => void) | undefined;
  const transcription = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finish = resolve;
  });
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const onSliceTranscriptionStabilized = vi.fn();
  const transcribeData = vi.fn(() => ({ promise: transcription }));
  const transcriber = new RealtimeTranscriber(
    { whisperContext: { transcribeData } as never, audioStream: audioStream as never },
    {},
    { onSliceTranscriptionStabilized },
  );
  await transcriber.start();
  onData({ data: Uint8Array.of(1, 2) });
  await Promise.all([transcriber.nextSlice(), transcriber.nextSlice()]);
  expect(transcribeData).toHaveBeenCalledOnce();
  expect(onSliceTranscriptionStabilized).not.toHaveBeenCalled();
  finish?.({ result: 'one final slice', segments: [] });
  await vi.waitFor(() => expect(onSliceTranscriptionStabilized).toHaveBeenCalledOnce());
  await transcriber.stop();
});

it('shows stabilization callbacks carry no slice identity even for different slices', async () => {
  let onData = (_data: { data: Uint8Array }) => {};
  let finishFirst: ((value: { result: string; segments: never[] }) => void) | undefined;
  let finishSecond: ((value: { result: string; segments: never[] }) => void) | undefined;
  const first = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finishFirst = resolve;
  });
  const second = new Promise<{ result: string; segments: never[] }>((resolve) => {
    finishSecond = resolve;
  });
  const transcribeData = vi
    .fn()
    .mockReturnValueOnce({ promise: first })
    .mockReturnValueOnce({ promise: second });
  const audioStream = {
    onData(callback: typeof onData) {
      onData = callback;
    },
    onError() {},
    onStatusChange() {},
    onEnd() {},
    isRecording: () => true,
    initialize: async () => {},
    start: async () => {},
    stop: async () => {},
  };
  const onSliceTranscriptionStabilized = vi.fn();
  const slices: number[] = [];
  const transcriber = new RealtimeTranscriber(
    { whisperContext: { transcribeData } as never, audioStream: audioStream as never },
    {},
    {
      onTranscribe(event) {
        if (event.type === 'transcribe') slices.push(event.sliceIndex ?? -1);
      },
      onSliceTranscriptionStabilized,
    },
  );
  await transcriber.start();
  onData({ data: Uint8Array.of(1, 2) });
  await transcriber.nextSlice();
  onData({ data: Uint8Array.of(3, 4) });
  await transcriber.nextSlice();
  finishFirst?.({ result: 'same text', segments: [] });
  await vi.waitFor(() => expect(transcribeData).toHaveBeenCalledTimes(2));
  expect(onSliceTranscriptionStabilized.mock.calls).toEqual([['same text']]);
  finishSecond?.({ result: 'same text', segments: [] });
  await vi.waitFor(() => expect(onSliceTranscriptionStabilized).toHaveBeenCalledTimes(2));
  expect(slices).toEqual([0, 1]);
  expect(onSliceTranscriptionStabilized.mock.calls).toEqual([['same text'], ['same text']]);
  await transcriber.stop();
});
