import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  require: vi.fn(),
  viewer: 'account-a' as string | null,
}));
vi.mock('expo', () => ({ requireNativeModule: state.require }));
vi.mock('@/lib/db/client', () => ({
  withActiveViewerLease: async (viewer: string | null, operation: () => Promise<void>) => {
    if (!viewer || viewer !== state.viewer) throw new Error('account changed');
    return operation();
  },
}));
vi.mock('@/lib/audio/capture-owner', () => ({
  captureOwnerKey: async (viewer: string) =>
    viewer === 'account-a' ? 'a'.repeat(64) : 'b'.repeat(64),
}));

import { eraseNativeCaptureAudio } from '@/lib/audio/native-erasure.native';

it('fails closed on a binary that predates the native module', async () => {
  state.require.mockImplementationOnce(() => {
    throw new Error('module missing');
  });
  await expect(
    eraseNativeCaptureAudio('account-a', 'a'.repeat(64), 'cap_1', 'wav'),
  ).rejects.toThrow('requires an updated app');
});

it('checks the active account and matching owner before entering the bridge', async () => {
  const eraseCaptureAudio = vi.fn().mockResolvedValue(undefined);
  state.require.mockReturnValue({ eraseCaptureAudio });
  await expect(
    eraseNativeCaptureAudio('account-a', 'b'.repeat(64), 'cap_1', 'wav'),
  ).rejects.toThrow('another account');
  expect(eraseCaptureAudio).not.toHaveBeenCalled();
  state.viewer = 'account-b';
  await expect(
    eraseNativeCaptureAudio('account-a', 'a'.repeat(64), 'cap_1', 'wav'),
  ).rejects.toThrow('account changed');
  expect(eraseCaptureAudio).not.toHaveBeenCalled();
  state.viewer = 'account-a';
  await eraseNativeCaptureAudio('account-a', 'a'.repeat(64), 'cap_1', 'wav');
  expect(eraseCaptureAudio).toHaveBeenCalledWith('a'.repeat(64), 'cap_1', 'wav');
});
