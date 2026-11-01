import React from 'react';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const { act, create } = createRequire(import.meta.url)('react-test-renderer');
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
import { RecordingPill } from '@/components/capture/recording-pill';
import { useCaptureStore } from '@/lib/stores/capture-store';

let root: ReturnType<typeof create> | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  useCaptureStore.getState().clearCapture();
  vi.unstubAllGlobals();
});

it('keeps a newer capture, including reused ID, when an earlier stop resolves', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (outcome: 'failed') => void;
  const stop = vi.fn(
    () =>
      new Promise<'failed'>((resolve) => {
        finish = resolve;
      }),
  );
  useCaptureStore.getState().startCapture('capture-a', 'note-a');
  useCaptureStore.getState().publishLive({
    phase: 'recording',
    levels: null,
    durationMs: 0,
    partialText: '',
    stop,
  });
  await act(async () => {
    root = create(React.createElement(RecordingPill));
  });
  await act(async () => {
    root?.root.findByProps({ accessibilityLabel: 'capture.stop' }).props.onPress();
    expect(stop).toHaveBeenCalledOnce();
    useCaptureStore.getState().clearCapture();
    useCaptureStore.getState().startCapture('capture-b', 'note-b');
    useCaptureStore.getState().clearCapture();
    useCaptureStore.getState().startCapture('capture-a', 'note-a');
  });
  await act(async () => {
    finish('failed');
    await Promise.resolve();
  });
  expect(useCaptureStore.getState().captureId).toBe('capture-a');
});

it('still clears the capture whose stop was requested', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const stop = vi.fn().mockResolvedValue('saved');
  useCaptureStore.getState().startCapture('capture-a', 'note-a');
  useCaptureStore.getState().publishLive({
    phase: 'recording',
    levels: null,
    durationMs: 0,
    partialText: '',
    stop,
  });
  await act(async () => {
    root = create(React.createElement(RecordingPill));
  });
  await act(async () => {
    root?.root.findByProps({ accessibilityLabel: 'capture.stop' }).props.onPress();
    await Promise.resolve();
  });
  expect(useCaptureStore.getState().captureId).toBeNull();
});
