import { expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  Paths: { document: {} },
}));

import { FileSystemChunkBackend } from '@/lib/audio/backend.native';

it('refuses to erase a legacy chunk directory without an account owner', async () => {
  await expect(new FileSystemChunkBackend().remove('cap_1')).rejects.toThrow(
    'ownership is unverified',
  );
});
