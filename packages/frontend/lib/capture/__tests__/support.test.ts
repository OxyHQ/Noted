import { describe, expect, it, vi } from 'vitest';

async function loadFor(os: string) {
  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: os, select: () => undefined } }));
  return import('@/lib/capture/support');
}

describe('capture support', () => {
  // Recording and transcribing are asked separately because the answers differ,
  // and an earlier version of this module conflated them — hiding a working
  // recorder on web behind a transcription engine that is not there.
  it('records everywhere, because expo-audio does', async () => {
    for (const os of ['ios', 'android', 'web']) {
      const { isCaptureSupported } = await loadFor(os);
      expect(isCaptureSupported()).toBe(true);
    }
  });

  it('transcribes only where whisper.cpp can run', async () => {
    expect((await loadFor('ios')).isTranscriptionSupported()).toBe(true);
    expect((await loadFor('android')).isTranscriptionSupported()).toBe(true);
    expect((await loadFor('web')).isTranscriptionSupported()).toBe(false);
  });

  it('keeps recordings past a restart only where there is a file system', async () => {
    expect((await loadFor('ios')).isCaptureDurable()).toBe(true);
    expect((await loadFor('android')).isCaptureDurable()).toBe(true);
    // A blob URL lives as long as the page, so a web capture cannot be recovered.
    expect((await loadFor('web')).isCaptureDurable()).toBe(false);
  });
});
