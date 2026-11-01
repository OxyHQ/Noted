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
