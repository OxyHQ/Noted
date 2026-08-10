/**
 * The storage a platform with no adapter of its own gets.
 *
 * Kept free of every platform-only import on purpose: the `.web` and `.native`
 * files beside it reach OPFS and `expo-file-system`, neither of which resolves
 * everywhere, and a bare `.ts` that imported one would break the other's bundler.
 * See the platform-split rule in the Bloom notes.
 *
 * In-memory rather than throwing. A recording that does not survive a reload is a
 * real limitation, and the store says so; a recorder that refuses to start
 * because storage is unusual would be worse.
 */

import type { ChunkBackend } from '@/lib/audio/artifact-store';
import { MemoryChunkBackend } from '@/lib/audio/memory-backend';

export function createChunkBackend(): ChunkBackend {
  return new MemoryChunkBackend();
}
