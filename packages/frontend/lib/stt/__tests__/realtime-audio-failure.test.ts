import React from 'react';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioArtifactStore } from '@/lib/audio/artifact-store';
import { MemoryChunkBackend } from '@/lib/audio/memory-backend';
import type { Recorder } from '@/lib/capture/recording';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const state = vi.hoisted(() => ({
  open: vi.fn(),
  describe: vi.fn(),
  openedClose: vi.fn(),
  contextClose: vi.fn(),
  stopFailure: null as Error | null,
  finalChunk: null as Uint8Array | null,
  beginCapture: vi.fn(),
  markRecording: vi.fn(),
  markStopping: vi.fn(),
  markStopped: vi.fn(),
  markFailed: vi.fn(),
  coordinatorFactory: vi.fn(),
  recorder: null as null | { ondataavailable: ((event: { data: Blob }) => void) | null },
}));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@oxy.so/bloom/button', () => ({ Button: 'Button' }));
vi.mock('@oxy.so/bloom/card', () => ({ Card: 'Card' }));
vi.mock('@oxy.so/bloom/icons/RiMicLine', () => ({ RiMicLine: 'MicIcon' }));
vi.mock('@oxy.so/bloom/icons/RiStopFill', () => ({ RiStopFill: 'StopIcon' }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('@/components/capture/waveform', () => ({ Waveform: 'Waveform' }));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/lib/capture/use-start-capture', () => ({
  useStartCapture: () => ({ isSupported: true, start: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/db/client', () => ({ getActiveViewerId: () => 'alice' }));
vi.mock('@/lib/audio/store', () => ({
  getAudioStore: () => ({ open: state.open, describe: state.describe }),
}));
vi.mock('@/lib/capture/captures-repo', () => ({
  beginCapture: state.beginCapture,
  upsertSegments: vi.fn(),
}));
vi.mock('@/lib/capture/audio-source', () => ({
  microphoneSource: () => ({
    id: 'microphone',
    open: async () => ({ stream: {} as MediaStream, close: state.openedClose }),
  }),
}));
vi.mock('@/lib/stt/engine.web', () => ({
  PARTIAL_TRANSCRIPTION: false,
  SAMPLE_RATE: 16000,
  transcribeSamples: vi.fn(),
}));
vi.mock('@/lib/stt/realtime', async () => import('@/lib/stt/realtime.web'));
vi.mock('@/lib/capture/live-coordinator', () => ({
  createLiveCoordinator: state.coordinatorFactory,
}));
import { useRealtimeRecorder } from '@/lib/capture/use-realtime-recorder.web';
import { RecordingPill } from '@/components/capture/recording-pill';
import { useCaptureStore } from '@/lib/stores/capture-store';

let root: ReturnType<typeof create> | undefined;
let current: Recorder | undefined;
function Harness({ enabled = true }: { enabled?: boolean }) {
  current = useRealtimeRecorder('capture', 'note', enabled, {
    model: 'tiny',
    language: 'en',
    notification: { title: '', body: '' },
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.beginCapture.mockResolvedValue(undefined);
  state.markRecording.mockResolvedValue(undefined);
  state.markStopping.mockResolvedValue(undefined);
  state.markStopped.mockResolvedValue(undefined);
  state.markFailed.mockResolvedValue(undefined);
  state.coordinatorFactory.mockImplementation(() => ({
    markRecording: state.markRecording,
    markStopping: state.markStopping,
    markStopped: state.markStopped,
    markFailed: state.markFailed,
    transcriptChanged: vi.fn(),
  }));
  state.recorder = null;
  state.stopFailure = null;
  state.finalChunk = null;
  state.contextClose.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'AudioContext',
    class {
      audioWorklet = { addModule: async () => {} };
      destination = {};
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createGain() {
        return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      }
      close = state.contextClose;
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null };
      connect = vi.fn();
      disconnect = vi.fn();
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
      start() {}
      stop() {
        if (state.stopFailure) throw state.stopFailure;
        if (state.finalChunk)
          this.ondataavailable?.({ data: new Blob([new Uint8Array(state.finalChunk)]) });
        this.onstop?.();
      }
    },
  );
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  current = undefined;
  vi.unstubAllGlobals();
});

it('reports a failed second chunk without finalizing the partial recording', async () => {
  const backend = new MemoryChunkBackend();
  const write = backend.put.bind(backend);
  const calls = vi.spyOn(backend, 'put').mockImplementation(async (id, index, bytes) => {
    if (index === 1) throw new Error('storage full');
    return write(id, index, bytes);
  });
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([9])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('error'));
  expect(current?.phase).toBe('error');
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.markFailed).toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalled();
  expect(await store.describe('capture')).toMatchObject({ complete: false, chunkCount: 1 });
  expect(Array.from((await store.readAll('capture'))[0])).toEqual([1, 2, 3]);
});

it('does not overwrite a chunk committed before an acknowledgement was lost', async () => {
  const backend = new MemoryChunkBackend();
  const write = backend.put.bind(backend);
  let writeCount = 0;
  const calls = vi.spyOn(backend, 'put').mockImplementation(async (id, index, bytes) => {
    writeCount += 1;
    await write(id, index, bytes);
    if (writeCount === 2) throw new Error('write acknowledgement lost');
  });
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([2])]) });
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([3])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('error'));
  expect(current?.phase).toBe('error');
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalled();
  expect(calls).toHaveBeenCalledTimes(2);
  const chunks = await store.readAll('capture');
  expect(chunks.map((chunk) => Array.from(chunk))).toEqual([[1], [2]]);
  expect(await store.describe('capture')).toMatchObject({ complete: false, chunkCount: 2 });
});

it('reports first-chunk failure without claiming a complete recording', async () => {
  const backend = new MemoryChunkBackend();
  const calls = vi.spyOn(backend, 'put').mockRejectedValue(new Error('first chunk failed'));
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('error'));
  expect(current?.phase).toBe('error');
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.markFailed).toHaveBeenCalledWith('persist_audio');
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
  expect(await store.describe('capture')).toMatchObject({ complete: false, chunkCount: 0 });
});

it('closes audio resources when recorder stop and chunk persistence both fail', async () => {
  const backend = new MemoryChunkBackend();
  const calls = vi.spyOn(backend, 'put').mockRejectedValue(new Error('chunk failed'));
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  state.stopFailure = new Error('recorder stop failed');
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('error'));
  expect(current?.phase).toBe('error');
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(state.contextClose).toHaveBeenCalledOnce();
  expect(await store.describe('capture')).toMatchObject({ complete: false, chunkCount: 0 });
});

it('documents that a close acknowledgement can fail after committing a complete manifest', async () => {
  const backend = new MemoryChunkBackend();
  const writeManifest = backend.writeManifest.bind(backend);
  vi.spyOn(backend, 'writeManifest').mockImplementation(async (id, json) => {
    await writeManifest(id, json);
    if (JSON.parse(json).complete) throw new Error('manifest acknowledgement lost');
  });
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(async () => expect((await store.readAll('capture')).length).toBe(1));
  });
  let outcome: string | undefined;
  await act(async () => {
    outcome = await current?.stop();
  });
  expect(outcome).toBe('failed');
  expect(current?.phase).toBe('error');
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalledOnce();
  expect(await store.describe('capture')).toMatchObject({ complete: true, chunkCount: 1 });
});

it('shares one stop when the user stops while a chunk write later fails', async () => {
  const backend = new MemoryChunkBackend();
  let failWrite!: (reason: Error) => void;
  const calls = vi.spyOn(backend, 'put').mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        failWrite = reject;
      }),
  );
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  let stopped!: Promise<string | undefined>;
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledOnce());
    stopped = current?.stop() as Promise<string | undefined>;
    await vi.waitFor(() => expect(state.markStopping).toHaveBeenCalledOnce());
    failWrite(new Error('delayed write failure'));
    expect(await stopped).toBe('failed');
  });
  expect(current?.phase).toBe('error');
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.markFailed).toHaveBeenCalledOnce();
  expect(state.openedClose).toHaveBeenCalledOnce();
});

it('stops after a chunk failure that occurs while markRecording is pending', async () => {
  const backend = new MemoryChunkBackend();
  const calls = vi.spyOn(backend, 'put').mockRejectedValue(new Error('write failed'));
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  let finishStart!: () => void;
  state.markRecording.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishStart = resolve;
      }),
  );
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(state.markRecording).toHaveBeenCalledOnce());
  expect(current?.phase).toBe('starting');
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledOnce());
    finishStart();
  });
  await vi.waitFor(() => expect(current?.phase).toBe('error'));
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.markFailed).toHaveBeenCalledWith('persist_audio');
  expect(state.openedClose).toHaveBeenCalledOnce();
});

it('finishes the pending stop after unmount when a chunk write later fails', async () => {
  const backend = new MemoryChunkBackend();
  let failWrite!: (error: Error) => void;
  const calls = vi.spyOn(backend, 'put').mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        failWrite = reject;
      }),
  );
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledOnce());
    root?.unmount();
  });
  root = undefined;
  await act(async () => {
    failWrite(new Error('write failed after unmount'));
  });
  await vi.waitFor(() => expect(state.openedClose).toHaveBeenCalledOnce());
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.markFailed).not.toHaveBeenCalled();
});

it('does not report an old stop failure on a newly enabled coordinator', async () => {
  const backend = new MemoryChunkBackend();
  let failWrite!: (error: Error) => void;
  const calls = vi.spyOn(backend, 'put').mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        failWrite = reject;
      }),
  );
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  const firstFailed = vi.fn().mockResolvedValue(undefined);
  const secondFailed = vi.fn().mockResolvedValue(undefined);
  const coordinator = (markFailed: ReturnType<typeof vi.fn>) => ({
    markRecording: vi.fn().mockResolvedValue(undefined),
    markStopping: vi.fn().mockResolvedValue(undefined),
    markStopped: vi.fn().mockResolvedValue(undefined),
    markFailed,
    transcriptChanged: vi.fn(),
  });
  state.coordinatorFactory.mockImplementationOnce(() => coordinator(firstFailed));
  state.coordinatorFactory.mockImplementationOnce(() => coordinator(secondFailed));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  let oldStop!: Promise<string | undefined>;
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledOnce());
    oldStop = current?.stop() as Promise<string | undefined>;
  });
  await act(async () => {
    root?.update(React.createElement(Harness, { enabled: false }));
  });
  await act(async () => {
    root?.update(React.createElement(Harness, { enabled: true }));
  });
  await vi.waitFor(() => expect(state.coordinatorFactory).toHaveBeenCalledTimes(2));
  await act(async () => {
    failWrite(new Error('old write failed'));
    await oldStop;
  });
  expect(firstFailed).not.toHaveBeenCalled();
  expect(secondFailed).not.toHaveBeenCalled();
});

it('does not stop or fail a newer capture when an older start rejects', async () => {
  const backend = new MemoryChunkBackend();
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  let failFirstStart!: (error: Error) => void;
  const firstRecording = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        failFirstStart = reject;
      }),
  );
  const secondFailed = vi.fn().mockResolvedValue(undefined);
  const first = {
    markRecording: firstRecording,
    markStopping: vi.fn().mockResolvedValue(undefined),
    markStopped: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    transcriptChanged: vi.fn(),
  };
  const second = {
    ...first,
    markRecording: vi.fn().mockResolvedValue(undefined),
    markFailed: secondFailed,
  };
  state.coordinatorFactory.mockImplementationOnce(() => first);
  state.coordinatorFactory.mockImplementationOnce(() => second);
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(firstRecording).toHaveBeenCalledOnce());
  await act(async () => {
    root?.update(React.createElement(Harness, { enabled: false }));
  });
  await act(async () => {
    root?.update(React.createElement(Harness, { enabled: true }));
  });
  await vi.waitFor(() => expect(second.markRecording).toHaveBeenCalledOnce());
  await act(async () => {
    failFirstStart(new Error('old start failed'));
  });
  expect(secondFailed).not.toHaveBeenCalled();
  expect(current?.phase).toBe('recording');
});

it('shows the actual recording pill failure after a chunk error', async () => {
  const backend = new MemoryChunkBackend();
  vi.spyOn(backend, 'put').mockRejectedValue(new Error('write failed'));
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  useCaptureStore.getState().startCapture('capture', 'note');
  function RealPillHarness() {
    const recorder = useRealtimeRecorder('capture', 'note', true, {
      model: 'tiny',
      language: 'en',
      notification: { title: '', body: '' },
    });
    const { phase, levels, durationMs, partialText, stop } = recorder;
    React.useEffect(() => {
      useCaptureStore.getState().publishLive({ phase, levels, durationMs, partialText, stop });
    }, [phase, levels, durationMs, partialText, stop]);
    return React.createElement(RecordingPill);
  }
  await act(async () => {
    root = create(React.createElement(RealPillHarness));
  });
  await vi.waitFor(() => expect(useCaptureStore.getState().phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
    await vi.waitFor(() => expect(state.openedClose).toHaveBeenCalledOnce());
  });
  await vi.waitFor(() => expect(useCaptureStore.getState().phase).toBe('error'));
  const content = JSON.stringify(root?.toJSON());
  expect(content).toContain('capture.status.failed');
  expect(content).not.toContain('capture.failed');
  expect(content).not.toContain('Waveform');
  expect(state.markStopped).not.toHaveBeenCalled();
  await act(async () => {
    useCaptureStore.getState().clearCapture();
  });
});

it('preserves the write error and releases resources if the failure listener throws', async () => {
  const write = vi.fn().mockRejectedValue(new Error('original write failed'));
  const close = vi.fn();
  state.open.mockResolvedValue({ write, close });
  const { startRealtimeTranscription } = await import('@/lib/stt/realtime.web');
  const session = await startRealtimeTranscription({
    captureId: 'capture',
    model: 'tiny',
    language: 'en',
    audioPath: '',
    onAudioStorageFailure: () => {
      throw new Error('listener failed');
    },
  });
  state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) });
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  await expect(session.stop()).rejects.toThrow('original write failed');
  expect(close).not.toHaveBeenCalled();
  expect(state.openedClose).toHaveBeenCalledOnce();
});

it('still saves a successful recording and keeps its audio reference', async () => {
  const backend = new MemoryChunkBackend();
  const writes = vi.spyOn(backend, 'put');
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  await act(async () => {
    state.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    await vi.waitFor(() => expect(writes).toHaveBeenCalledOnce());
  });
  let outcome: string | undefined;
  await act(async () => {
    outcome = await current?.stop();
  });
  expect(outcome).toBe('saved');
  expect(current?.phase).toBe('saved');
  expect(state.markStopped).toHaveBeenCalledWith(expect.any(Number), 'audio:capture');
  expect(state.markFailed).not.toHaveBeenCalled();
  expect(await store.describe('capture')).toMatchObject({ complete: true, chunkCount: 1 });
});

it('reports a failure in the final chunk emitted during stop', async () => {
  const backend = new MemoryChunkBackend();
  vi.spyOn(backend, 'put').mockRejectedValue(new Error('final chunk failed'));
  const store = new AudioArtifactStore(backend);
  state.open.mockImplementation((id: string, mime: string) => store.open(id, mime));
  state.describe.mockImplementation((id: string) => store.describe(id));
  await act(async () => {
    root = create(React.createElement(Harness));
  });
  await vi.waitFor(() => expect(current?.phase).toBe('recording'));
  state.finalChunk = new Uint8Array([7]);
  let outcome: string | undefined;
  await act(async () => {
    outcome = await current?.stop();
  });
  expect(outcome).toBe('failed');
  expect(current?.phase).toBe('error');
  expect(state.markStopping).toHaveBeenCalledOnce();
  expect(state.markStopped).not.toHaveBeenCalled();
  expect(state.markFailed).toHaveBeenCalledOnce();
  expect(await store.describe('capture')).toMatchObject({ complete: false });
});
