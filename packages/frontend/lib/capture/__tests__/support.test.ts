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

  it('transcribes everywhere, by two different routes', async () => {
    // whisper.cpp on a phone, an ONNX build of the same model in the browser.
    for (const os of ['ios', 'android', 'web']) {
      expect((await loadFor(os)).isTranscriptionSupported()).toBe(true);
    }
  });

  it('stores model weights only where there is a file system to store them in', async () => {
    // The distinction that took a crash to learn: the browser transcribes with
    // a model transformers.js fetches and caches itself, and asking
    // `expo-file-system` about it throws rather than reporting absence.
    expect((await loadFor('ios')).hasDownloadableModels()).toBe(true);
    expect((await loadFor('android')).hasDownloadableModels()).toBe(true);
    expect((await loadFor('web')).hasDownloadableModels()).toBe(false);
  });

  it('keeps recordings past a restart only where there is a file system', async () => {
    expect((await loadFor('ios')).isCaptureDurable()).toBe(true);
    expect((await loadFor('android')).isCaptureDurable()).toBe(true);
    // A blob URL lives as long as the page, so a web capture cannot be recovered.
    expect((await loadFor('web')).isCaptureDurable()).toBe(false);
  });
});
