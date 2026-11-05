import { beforeEach, describe, expect, it, vi } from 'vitest';

// A small in-memory file system behind expo-file-system, so the native backend's
// own `remove` runs against real paths. Only the platform boundary is faked.
const fs = vi.hoisted(() => ({ files: new Set<string>() }));

vi.mock('expo-file-system', () => {
  const pathOf = (parts: unknown[]) =>
    parts
      .map((part) => (typeof part === 'string' ? part : (part as { path: string }).path))
      .join('/');
  const within = (dir: string, file: string) => file === dir || file.startsWith(`${dir}/`);
  class Directory {
    readonly path: string;
    constructor(...parts: unknown[]) {
      this.path = pathOf(parts);
    }
    get exists() {
      return [...fs.files].some((file) => within(this.path, file));
    }
    create() {}
    delete() {
      for (const file of [...fs.files]) if (within(this.path, file)) fs.files.delete(file);
    }
    list() {
      return [];
    }
  }
  class File {
    readonly path: string;
    constructor(...parts: unknown[]) {
      this.path = pathOf(parts);
    }
    get exists() {
      return fs.files.has(this.path);
    }
  }
  return { Directory, File, Paths: { document: { path: 'docs' } } };
});

vi.mock('@/lib/audio/backend', async () => ({
  createChunkBackend: (await import('@/lib/audio/backend.native')).createChunkBackend,
}));

import { captureDirectorySegments } from '@/lib/audio/capture-directory';
import { deleteCaptureAudio } from '@/lib/audio/store';

beforeEach(() => fs.files.clear());

describe('deleting a capture on the phone', () => {
  it("removes the capture's own native file and leaves other captures alone", async () => {
    fs.files.add('docs/captures/cap_1/audio.m4a');
    fs.files.add('docs/audio/cap_1/000000.bin');
    fs.files.add('docs/captures/cap_2/audio.m4a');

    await deleteCaptureAudio('captures/cap_1/audio.m4a', 'cap_1');

    expect([...fs.files]).toEqual(['docs/captures/cap_2/audio.m4a']);
  });

  it('removes a wav written by the realtime recorder the same way', async () => {
    fs.files.add('docs/captures/cap_1/audio.wav');
    await deleteCaptureAudio('captures/cap_1/audio.wav', 'cap_1');
    expect(fs.files.size).toBe(0);
  });

  it('is a no-op the second time', async () => {
    fs.files.add('docs/captures/cap_1/audio.m4a');
    await deleteCaptureAudio('captures/cap_1/audio.m4a', 'cap_1');
    await expect(deleteCaptureAudio('captures/cap_1/audio.m4a', 'cap_1')).resolves.toBeUndefined();
    expect(fs.files.size).toBe(0);
  });

  it('refuses a reference that names another capture and removes nothing', async () => {
    fs.files.add('docs/captures/cap_2/audio.m4a');
    await expect(deleteCaptureAudio('captures/cap_2/audio.m4a', 'cap_1')).rejects.toThrow(
      'another capture',
    );
    expect([...fs.files]).toEqual(['docs/captures/cap_2/audio.m4a']);
  });

  it('never turns an unsafe id into a path', async () => {
    fs.files.add('docs/captures/cap_2/audio.m4a');
    await expect(deleteCaptureAudio('captures/../cap_2/audio.m4a', '../cap_2')).rejects.toThrow(
      'unsafe capture id',
    );
    expect([...fs.files]).toEqual(['docs/captures/cap_2/audio.m4a']);
  });

  it('does not follow a legacy reference in a form this app did not write', async () => {
    fs.files.add('docs/shared/audio.m4a');
    await deleteCaptureAudio('file:///shared/audio.m4a', 'cap_1');
    expect([...fs.files]).toEqual(['docs/shared/audio.m4a']);
  });
});

describe('capture directory segments', () => {
  it('names exactly the capture directory for a UUID-shaped id', () => {
    expect(captureDirectorySegments('0190b1c2-3d4e-7f60-8a9b-0c1d2e3f4a5b')).toEqual([
      'captures',
      '0190b1c2-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    ]);
  });

  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\nb', 'a b', 'x'.repeat(129)])('refuses %j', (id) => {
    expect(() => captureDirectorySegments(id)).toThrow('unsafe capture id');
  });
});
