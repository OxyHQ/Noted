/**
 * A chunk backend that keeps everything in a Map.
 *
 * Not a test double bolted on afterwards — it is the reference implementation the
 * conformance tests run against, and the thing that makes the interesting
 * questions answerable at all: what a half-written recording looks like after a
 * crash, whether chunks come back in order, whether deletion leaves anything
 * behind. None of those are testable if the only implementation needs a browser.
 *
 * It ships rather than living in `__tests__` because a platform backend can be
 * checked against the same suite, and because a device with no durable storage
 * available is better served by a store that works until the page closes than by
 * one that throws.
 */

import type { ChunkBackend } from '@/lib/audio/artifact-store';

export class MemoryChunkBackend implements ChunkBackend {
  private readonly chunks = new Map<string, Map<number, Uint8Array>>();
  private readonly manifests = new Map<string, string>();

  put(captureId: string, index: number, chunk: Uint8Array): Promise<void> {
    const forCapture = this.chunks.get(captureId) ?? new Map<number, Uint8Array>();
    // Copied, because the caller owns the buffer it handed over and a recorder
    // reusing one would silently rewrite audio already "stored".
    forCapture.set(index, new Uint8Array(chunk));
    this.chunks.set(captureId, forCapture);
    return Promise.resolve();
  }

  indices(captureId: string): Promise<number[]> {
    return Promise.resolve([...(this.chunks.get(captureId)?.keys() ?? [])]);
  }

  read(captureId: string, index: number): Promise<Uint8Array> {
    const chunk = this.chunks.get(captureId)?.get(index);
    if (!chunk) return Promise.reject(new Error(`no chunk ${String(index)} for ${captureId}`));
    return Promise.resolve(chunk);
  }

  captures(): Promise<string[]> {
    return Promise.resolve([...new Set([...this.chunks.keys(), ...this.manifests.keys()])]);
  }

  readManifest(captureId: string): Promise<string | null> {
    return Promise.resolve(this.manifests.get(captureId) ?? null);
  }

  writeManifest(captureId: string, json: string): Promise<void> {
    this.manifests.set(captureId, json);
    return Promise.resolve();
  }

  remove(captureId: string): Promise<void> {
    this.chunks.delete(captureId);
    this.manifests.delete(captureId);
    return Promise.resolve();
  }
}
