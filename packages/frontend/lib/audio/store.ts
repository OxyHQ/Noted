/**
 * The one audio store the app talks to.
 *
 * One instance per process, because the store is a handle to storage rather than
 * state: two would open the same files and disagree about nothing, but they would
 * also each pay for the connection.
 *
 * Playback handles live here too, and that is the point of the file. An object
 * URL is a temporary handle to durable bytes; treating one as the recording is
 * what produced a capture row that resolved to nothing after a reload. Callers
 * ask for a handle when they need one and give it back when they are done.
 */

import { AudioArtifactStore, captureIdOfRef } from '@/lib/audio/artifact-store';
import { createChunkBackend } from '@/lib/audio/backend';

let store: AudioArtifactStore | null = null;

export function getAudioStore(): AudioArtifactStore {
  store ??= new AudioArtifactStore(createChunkBackend());
  return store;
}

/**
 * A URL something can play or decode, for as long as it holds it.
 *
 * Reads the whole recording into memory, which is inherent — a player needs the
 * bytes — and is why this is an explicit call rather than something the recorder
 * does as it goes.
 *
 * @returns null when the reference is not one of ours (a native filesystem path,
 *   which the caller can use directly) or when nothing is stored for it.
 */
export async function createPlaybackUrl(reference: string): Promise<string | null> {
  const captureId = captureIdOfRef(reference);
  if (captureId === null) return null;

  const audioStore = getAudioStore();
  const artifact = await audioStore.describe(captureId);
  if (!artifact || artifact.chunkCount === 0) return null;

  const chunks = await audioStore.readAll(captureId);
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: artifact.mimeType }));
}

/**
 * Hand a playback handle back.
 *
 * Not optional housekeeping: an object URL pins its blob for the lifetime of the
 * document, so a screen that mints one per render leaks a recording per render.
 */
export function releasePlaybackUrl(url: string | null): void {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

/** Forget a recording's audio, wherever it is stored. */
export async function deleteCaptureAudio(reference: string, captureId: string): Promise<void> {
  await getAudioStore().remove(captureIdOfRef(reference) ?? captureId);
}
