import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioArtifactStore } from '@/lib/audio/artifact-store';
import { createChunkBackend } from '@/lib/audio/backend.web';

afterEach(() => vi.unstubAllGlobals());

function opfs(root: unknown) {
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => ({ getDirectoryHandle: async () => root }) },
  });
}

describe('OPFS audio read failures', () => {
  it('treats a missing root as empty without creating it', async () => {
    const lookup = vi.fn().mockRejectedValue(new DOMException('missing', 'NotFoundError'));
    vi.stubGlobal('navigator', {
      storage: { getDirectory: async () => ({ getDirectoryHandle: lookup }) },
    });
    const backend = createChunkBackend();
    await expect(backend.indices('capture')).resolves.toEqual([]);
    await expect(backend.captures()).resolves.toEqual([]);
    await expect(backend.readManifest('capture')).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledWith('noted-audio', { create: false });
  });

  it('treats missing capture and missing deletion target as absent', async () => {
    const missing = new DOMException('missing', 'NotFoundError');
    const root = {
      getDirectoryHandle: vi.fn().mockRejectedValue(missing),
      removeEntry: vi.fn().mockRejectedValue(missing),
    };
    opfs(root);
    const backend = createChunkBackend();
    await expect(backend.indices('capture')).resolves.toEqual([]);
    await expect(backend.readManifest('capture')).resolves.toBeNull();
    await expect(backend.remove('capture')).resolves.toBeUndefined();
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('capture', { create: false });
    expect(root.removeEntry).toHaveBeenCalledWith('capture', { recursive: true });
  });

  it('propagates permission failures instead of reporting an empty store', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => {
          throw denied;
        },
      },
    });
    const backend = createChunkBackend();
    await expect(backend.indices('capture')).rejects.toBe(denied);
    await expect(backend.captures()).rejects.toBe(denied);
    await expect(backend.readManifest('capture')).rejects.toBe(denied);
  });

  it('does not treat an unavailable OPFS root as a missing audio directory', async () => {
    const failure = new DOMException('OPFS unavailable', 'NotFoundError');
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => {
          throw failure;
        },
      },
    });
    const backend = createChunkBackend();
    await expect(backend.indices('capture')).rejects.toBe(failure);
    await expect(backend.captures()).rejects.toBe(failure);
    await expect(backend.readManifest('capture')).rejects.toBe(failure);
    await expect(backend.remove('capture')).rejects.toBe(failure);
  });

  it('does not turn a partial listing failure into an empty capture', async () => {
    const vanished = new DOMException('directory changed', 'NotFoundError');
    const capture = {
      async *keys() {
        yield '000000.bin';
        throw vanished;
      },
    };
    opfs({ getDirectoryHandle: async () => capture });
    await expect(createChunkBackend().indices('capture')).rejects.toBe(vanished);
  });

  it('does not turn a root listing failure into an empty list', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    opfs({
      keys: () => ({
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          throw denied;
        },
      }),
    });
    await expect(createChunkBackend().captures()).rejects.toBe(denied);
  });

  it('accepts a missing manifest at lookup, but not an error reading a resolved handle', async () => {
    const missing = new DOMException('missing', 'NotFoundError');
    const capture = {
      getFileHandle: vi
        .fn()
        .mockRejectedValueOnce(missing)
        .mockResolvedValueOnce({
          getFile: async () => {
            throw missing;
          },
        }),
    };
    opfs({ getDirectoryHandle: async () => capture });
    const backend = createChunkBackend();
    await expect(backend.readManifest('capture')).resolves.toBeNull();
    await expect(backend.readManifest('capture')).rejects.toBe(missing);
  });

  it('does not open a writer or touch the manifest after a chunk-listing error', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    const writable = vi.fn();
    const capture = {
      getFileHandle: vi.fn(async () => ({
        getFile: async () => ({
          text: async () => '{"mimeType":"audio/wav","complete":true,"chunkBytes":[3]}',
        }),
        createWritable: writable,
      })),
      keys: () => ({
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          throw denied;
        },
      }),
    };
    opfs({ getDirectoryHandle: async () => capture });
    await expect(
      new AudioArtifactStore(createChunkBackend()).open('capture', 'audio/wav'),
    ).rejects.toBe(denied);
    expect(writable).not.toHaveBeenCalled();
  });
});
