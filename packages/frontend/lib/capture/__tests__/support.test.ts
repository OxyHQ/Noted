import { describe, expect, it, vi } from 'vitest';

/** Load `isCaptureSupported` as it behaves on one platform. */
async function loadFor(os: string): Promise<boolean> {
  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: os, select: () => undefined } }));
  const { isCaptureSupported } = await import('@/lib/capture/support');
  return isCaptureSupported();
}

describe('isCaptureSupported', () => {
  it('is true where there is a file system to write the recording to', async () => {
    expect(await loadFor('ios')).toBe(true);
    expect(await loadFor('android')).toBe(true);
  });

  // The bug this guards: `expo-file-system`'s File and Directory are empty stubs
  // on web, so `directory.create()` throws even after the browser has granted
  // the microphone. Offering the control there means asking the user for a
  // permission and then failing — worse than not offering it.
  it('is false on web, where there is nowhere to put the audio', async () => {
    expect(await loadFor('web')).toBe(false);
  });

  it('is false on any platform it has not been proven on', async () => {
    expect(await loadFor('windows')).toBe(false);
    expect(await loadFor('macos')).toBe(false);
  });
});
