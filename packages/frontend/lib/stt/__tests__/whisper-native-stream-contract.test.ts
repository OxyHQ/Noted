import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  init: vi.fn(),
  on: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@fugood/react-native-audio-pcm-stream', () => ({ default: native }));

import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';

it('documents that the adapter can start before native initialization settles', async () => {
  let completeInit: (() => void) | undefined;
  let initialized = false;
  const init = new Promise<void>((resolve) => {
    completeInit = resolve;
  }).then(() => {
    initialized = true;
  });
  native.init.mockReturnValue(init);
  native.start.mockClear();
  const adapter = new AudioPcmStreamAdapter();
  await adapter.initialize({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
  expect(initialized).toBe(false);
  await adapter.start();
  expect(native.start).toHaveBeenCalledOnce();
  expect(initialized).toBe(false);
  completeInit?.();
  await init;
});

it('documents that release does not remove the native event subscription', async () => {
  const remove = vi.fn();
  native.init.mockResolvedValue(undefined);
  native.on.mockReturnValue({ remove });
  const adapter = new AudioPcmStreamAdapter();
  await adapter.initialize({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
  await adapter.release();
  expect(remove).not.toHaveBeenCalled();
});
