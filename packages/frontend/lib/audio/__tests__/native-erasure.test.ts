import { beforeEach, expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({
  files: new Set<string>(),
  removedChunks: [] as string[],
  nativeError: null as Error | null,
}));
vi.mock('@/lib/audio/backend', () => ({
  createChunkBackend: () => ({
    remove: async (id: string) => {
      device.removedChunks.push(id);
    },
  }),
}));
vi.mock('@/lib/audio/native-erasure', () => ({
  eraseNativeCaptureAudio: async (
    viewer: string | null,
    owner: string,
    id: string,
    extension: string,
  ) => {
    if (device.nativeError) throw device.nativeError;
    if (viewer !== 'account-a' || owner !== 'a'.repeat(64)) throw new Error('account mismatch');
    device.files.delete(`captures-v2/${owner}/${id}/audio.${extension}`);
  },
}));
import { deleteCaptureAudio } from '@/lib/audio/store';

const OWNER_A = 'a'.repeat(64);
const OWNER_B = 'b'.repeat(64);
const path = (owner: string, id: string, ext: string) => `captures-v2/${owner}/${id}/audio.${ext}`;

beforeEach(() => {
  device.files.clear();
  device.removedChunks.length = 0;
  device.nativeError = null;
});

it.each(['wav', 'm4a'])('erases only the viewer-owned %s file', async (ext) => {
  device.files.add(path(OWNER_A, 'cap_1', ext));
  device.files.add(path(OWNER_B, 'cap_1', ext));
  await deleteCaptureAudio(path(OWNER_A, 'cap_1', ext), 'cap_1', 'account-a');
  expect([...device.files]).toEqual([path(OWNER_B, 'cap_1', ext)]);
  expect(device.removedChunks).toEqual([]);
});

it('can repeat a deletion after the native file has gone', async () => {
  device.files.add(path(OWNER_A, 'cap_1', 'wav'));
  await deleteCaptureAudio(path(OWNER_A, 'cap_1', 'wav'), 'cap_1', 'account-a');
  await deleteCaptureAudio(path(OWNER_A, 'cap_1', 'wav'), 'cap_1', 'account-a');
  expect(device.files.size).toBe(0);
});

it.each([
  ['captures/cap_1/audio.wav', 'cap_1'],
  [path(OWNER_B, 'cap_2', 'wav'), 'cap_1'],
  ['audio:cap_2', 'cap_1'],
  ['captures/../cap_1/audio.wav', 'cap_1'],
  [path(OWNER_A, 'cap_1', 'wav') + '/..', 'cap_1'],
  ['file:///outside/audio.wav', 'cap_1'],
  [path(OWNER_A, 'cap_1', 'mp3'), 'cap_1'],
  ['audio:../other', '../other'],
  ['captures/%2e%2e/audio.wav', '%2e%2e'],
  [path(OWNER_A, 'cap_1', 'wav') + '\n', 'cap_1'],
  ['audio:cap_1\n', 'cap_1\n'],
])('refuses an untrusted or legacy reference %s', async (reference, id) => {
  device.files.add(path(OWNER_B, 'cap_1', 'wav'));
  await expect(deleteCaptureAudio(reference, id, 'account-a')).rejects.toThrow();
  expect(device.files.has(path(OWNER_B, 'cap_1', 'wav'))).toBe(true);
  expect(device.removedChunks).toEqual([]);
});

it('rejects a different account without touching its file', async () => {
  device.files.add(path(OWNER_B, 'cap_1', 'wav'));
  await expect(
    deleteCaptureAudio(path(OWNER_B, 'cap_1', 'wav'), 'cap_1', 'account-a'),
  ).rejects.toThrow('account mismatch');
  expect(device.files.size).toBe(1);
});

it('propagates a native failure', async () => {
  device.files.add(path(OWNER_A, 'cap_1', 'wav'));
  device.nativeError = new Error('permission denied');
  await expect(
    deleteCaptureAudio(path(OWNER_A, 'cap_1', 'wav'), 'cap_1', 'account-a'),
  ).rejects.toThrow('permission denied');
  expect(device.files.size).toBe(1);
});

it('delegates matching browser chunks using the capture id', async () => {
  await deleteCaptureAudio('audio:cap_1', 'cap_1', 'account-a');
  expect(device.removedChunks).toEqual(['cap_1']);
});
