/**
 * Durable audio storage on a phone: files, where they already were.
 *
 * The native recorders write a file directly — whisper.rn writes its own WAV, and
 * `expo-audio` hands back a recording it saved — so a phone never had the
 * browser's problem. What it did NOT have is one place that knows which
 * recordings exist, how to list a half-finished one, and how to delete every
 * trace of one. That is what routing native audio through the same store buys.
 *
 * Chunks are separate files under the capture's own directory, so deleting a
 * recording remains one recursive remove.
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { ChunkBackend } from '@/lib/audio/artifact-store';

const ROOT = 'audio';
const MANIFEST = 'manifest.json';

function chunkName(index: number): string {
  return `${String(index).padStart(6, '0')}.bin`;
}

function indexOfName(name: string): number | null {
  const found = /^(\d{6})\.bin$/.exec(name);
  return found ? Number(found[1]) : null;
}

function captureDirectory(captureId: string): Directory {
  return new Directory(Paths.document, ROOT, captureId);
}

function ensure(captureId: string): Directory {
  const directory = captureDirectory(captureId);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export class FileSystemChunkBackend implements ChunkBackend {
  put(captureId: string, index: number, chunk: Uint8Array): Promise<void> {
    const file = new File(ensure(captureId), chunkName(index));
    file.create({ overwrite: true });
    file.write(chunk);
    return Promise.resolve();
  }

  indices(captureId: string): Promise<number[]> {
    const directory = captureDirectory(captureId);
    if (!directory.exists) return Promise.resolve([]);
    return Promise.resolve(
      directory
        .list()
        .map((entry) => indexOfName(entry.name))
        .filter((index): index is number => index !== null),
    );
  }

  read(captureId: string, index: number): Promise<Uint8Array> {
    const file = new File(captureDirectory(captureId), chunkName(index));
    if (!file.exists) {
      return Promise.reject(new Error(`no chunk ${String(index)} for ${captureId}`));
    }
    return Promise.resolve(file.bytes());
  }

  captures(): Promise<string[]> {
    const root = new Directory(Paths.document, ROOT);
    if (!root.exists) return Promise.resolve([]);
    return Promise.resolve(root.list().map((entry) => entry.name));
  }

  readManifest(captureId: string): Promise<string | null> {
    const file = new File(captureDirectory(captureId), MANIFEST);
    return Promise.resolve(file.exists ? file.text() : null);
  }

  writeManifest(captureId: string, json: string): Promise<void> {
    const file = new File(ensure(captureId), MANIFEST);
    file.create({ overwrite: true });
    file.write(json);
    return Promise.resolve();
  }

  remove(captureId: string): Promise<void> {
    const directory = captureDirectory(captureId);
    // Deleting a recording twice is not an error.
    if (directory.exists) directory.delete();
    return Promise.resolve();
  }
}

export function createChunkBackend(): ChunkBackend {
  return new FileSystemChunkBackend();
}
