import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  open: vi.fn(),
  describe: vi.fn(),
  openedClose: vi.fn(),
  contextClose: vi.fn(),
  sourceDisconnect: vi.fn(),
  captureDisconnect: vi.fn(),
  silenceDisconnect: vi.fn(),
  recorderStart: vi.fn(),
  transcribe: vi.fn(),
  worklet: null as null | {
    port: { onmessage: ((event: { data: { type: string; data: ArrayBuffer } }) => void) | null };
  },
  recorder: null as null | {
    ondataavailable: ((event: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
  },
  holdStop: false,
  stopError: null as Error | null,
}));
vi.mock('@/lib/db/client', () => ({ getActiveViewerId: () => 'alice' }));
vi.mock('@/lib/audio/store', () => ({
  getAudioStore: () => ({ open: state.open, describe: state.describe }),
}));
vi.mock('@/lib/capture/captures-repo', () => ({ upsertSegments: vi.fn() }));
vi.mock('@/lib/capture/audio-source', () => ({ microphoneSource: vi.fn() }));
vi.mock('@/lib/stt/engine.web', () => ({
  PARTIAL_TRANSCRIPTION: false,
  SAMPLE_RATE: 16000,
  transcribeSamples: state.transcribe,
}));
import { startRealtimeTranscription } from '@/lib/stt/realtime.web';

beforeEach(() => {
  vi.clearAllMocks();
  state.contextClose.mockResolvedValue(undefined);
  state.transcribe.mockResolvedValue([]);
  state.holdStop = false;
  state.stopError = null;
  state.worklet = null;
  state.recorder = null;
  vi.stubGlobal(
    'AudioContext',
    class {
      audioWorklet = { addModule: async () => {} };
      destination = {};
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: state.sourceDisconnect };
      }
      createGain() {
        return { gain: { value: 0 }, connect: vi.fn(), disconnect: state.silenceDisconnect };
      }
      close = state.contextClose;
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port: { onmessage: ((event: { data: { type: string; data: ArrayBuffer } }) => void) | null } =
        { onmessage: null };
      constructor() {
        state.worklet = this;
      }
      connect = vi.fn();
      disconnect = state.captureDisconnect;
    },
  );
  vi.stubGlobal(
    'MediaRecorder',
    class {
      mimeType = 'audio/webm';
      onstop: (() => void) | null = null;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      constructor() {
        state.recorder = this;
      }
      start = state.recorderStart;
      stop() {
        if (state.stopError) throw state.stopError;
        if (!state.holdStop) this.onstop?.();
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const options = () => ({
  captureId: 'capture',
  model: 'tiny' as const,
  language: 'auto',
  audioPath: '',
  audioSource: {
    id: 'microphone' as const,
    open: async () => ({ stream: {} as MediaStream, close: state.openedClose }),
  },
});

it('does not start recording and releases the microphone when storage open fails', async () => {
  const failure = new DOMException('storage denied', 'NotAllowedError');
  const rejected = Promise.reject(failure);
  void rejected.catch(() => {});
  state.open.mockReturnValue(rejected);
  const result = await startRealtimeTranscription(options()).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect(result).not.toBeInstanceOf(DOMException);
  expect((result as Error & { cause: unknown }).cause).toBe(failure);
  expect(state.recorderStart).not.toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
  expect(state.sourceDisconnect).toHaveBeenCalledOnce();
  expect(state.captureDisconnect).toHaveBeenCalledOnce();
  expect(state.silenceDisconnect).toHaveBeenCalledOnce();
});

it('closes the source before waiting for an AudioContext close that is still pending', async () => {
  let finishClose!: () => void;
  state.contextClose.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
  );
  state.open.mockRejectedValue(new Error('storage failed'));
  const outcome = startRealtimeTranscription(options()).catch((error: unknown) => error);
  await vi.waitFor(() => expect(state.openedClose).toHaveBeenCalledOnce());
  expect(state.contextClose).toHaveBeenCalledOnce();
  finishClose();
  expect(await outcome).toBeInstanceOf(Error);
});

it('attempts all cleanup and retains the storage failure if disconnect fails', async () => {
  const storage = new Error('storage failed');
  state.open.mockRejectedValue(storage);
  state.sourceDisconnect.mockImplementationOnce(() => {
    throw new Error('disconnect failed');
  });
  const result = await startRealtimeTranscription(options()).catch((error: unknown) => error);
  expect((result as Error & { cause: unknown }).cause).toBe(storage);
  expect((result as Error & { cleanupError: unknown }).cleanupError).toBeInstanceOf(Error);
  expect(state.captureDisconnect).toHaveBeenCalledOnce();
  expect(state.silenceDisconnect).toHaveBeenCalledOnce();
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
});

it('returns the existing audio reference after a successful stop', async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  state.open.mockResolvedValue({ write: vi.fn(), close });
  state.describe.mockResolvedValue({ chunkCount: 1 });
  const session = await startRealtimeTranscription(options());
  await expect(session.stop()).resolves.toBe('audio:capture');
  expect(close).toHaveBeenCalledOnce();
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
});

it('releases microphone and context even if finalizing the writer fails', async () => {
  state.open.mockResolvedValue({
    write: vi.fn(),
    close: vi.fn().mockRejectedValue(new Error('close failed')),
  });
  const session = await startRealtimeTranscription(options());
  await expect(session.stop()).rejects.toThrow('close failed');
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
  expect(state.sourceDisconnect).toHaveBeenCalledOnce();
  expect(state.captureDisconnect).toHaveBeenCalledOnce();
  expect(state.silenceDisconnect).toHaveBeenCalledOnce();
});

it('writes a final chunk before acknowledging stop', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  state.open.mockResolvedValue({ write, close });
  state.describe.mockResolvedValue({ chunkCount: 1 });
  state.holdStop = true;
  const session = await startRealtimeTranscription(options());
  const stopped = session.stop();
  expect(state.recorder).not.toBeNull();
  state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([7, 8])]) });
  state.recorder?.onstop?.();
  await expect(stopped).resolves.toBe('audio:capture');
  expect(write).toHaveBeenCalledWith(new Uint8Array([7, 8]));
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
});

it('releases audio resources if the browser rejects recorder start', async () => {
  state.open.mockResolvedValue({ write: vi.fn(), close: vi.fn() });
  state.recorderStart.mockImplementationOnce(() => {
    throw new Error('recorder start failed');
  });
  await expect(startRealtimeTranscription(options())).rejects.toThrow('recorder start failed');
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
});

it('releases the microphone and context when recorder stop throws', async () => {
  const close = vi.fn();
  state.open.mockResolvedValue({ write: vi.fn(), close });
  const session = await startRealtimeTranscription(options());
  state.stopError = new Error('recorder stop failed');
  await expect(session.stop()).rejects.toThrow('recorder stop failed');
  expect(close).not.toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
});

it('preserves both writer and resource cleanup errors', async () => {
  const writerError = new Error('writer close failed');
  const cleanupError = new Error('source release failed');
  state.open.mockResolvedValue({ write: vi.fn(), close: vi.fn().mockRejectedValue(writerError) });
  state.openedClose.mockImplementationOnce(() => {
    throw cleanupError;
  });
  const session = await startRealtimeTranscription(options());
  const failure = await session.stop().catch((error: unknown) => error);
  const errors = (failure as { errors: unknown[] }).errors;
  expect(errors[0]).toBe(writerError);
  expect((errors[1] as { errors: unknown[] }).errors).toContain(cleanupError);
  expect(state.contextClose).toHaveBeenCalledOnce();
});
