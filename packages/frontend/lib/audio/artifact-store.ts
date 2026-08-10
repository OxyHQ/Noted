/**
 * Where a recording's audio lives, and how it survives the tab being closed.
 *
 * The browser path stored a `blob:` URL in the capture row and kept the whole
 * recording in memory until stop. Both halves of that are broken: the URL is
 * meaningless after a reload — the object it pointed at died with the page — and
 * an hour-long meeting is an hour of audio held in RAM by a tab the user has
 * probably backgrounded. A local-first product cannot lose a recording because
 * somebody refreshed.
 *
 * So audio is written incrementally, in chunks, to durable storage, and the
 * capture row holds a DURABLE IDENTIFIER rather than a handle. An object URL is
 * minted only when something actually needs to play or decode the recording, and
 * revoked afterwards — a temporary playback handle, which is all it ever was.
 *
 * ## Why the storage itself is a port
 *
 * The interesting behaviour here is not "call OPFS": it is chunk ordering, what a
 * half-written recording looks like after a crash, and making sure deletion
 * leaves nothing behind. None of that is testable if it can only run in a
 * browser. So this module owns the logic against a small {@link ChunkBackend},
 * and each platform supplies the storage underneath it.
 */

/** Storage, reduced to the six operations the logic above it needs. */
export interface ChunkBackend {
  /** Store one chunk of a capture, named by its position. */
  put(captureId: string, index: number, chunk: Uint8Array): Promise<void>;
  /** The chunk positions present for a capture, in any order. */
  indices(captureId: string): Promise<number[]>;
  read(captureId: string, index: number): Promise<Uint8Array>;
  /** Every capture that has anything stored, including a half-written one. */
  captures(): Promise<string[]>;
  readManifest(captureId: string): Promise<string | null>;
  writeManifest(captureId: string, json: string): Promise<void>;
  /** Remove everything for a capture: chunks, manifest, and the container. */
  remove(captureId: string): Promise<void>;
}

/** What is known about a stored recording without reading its audio. */
export interface AudioArtifact {
  captureId: string;
  mimeType: string;
  bytes: number;
  chunkCount: number;
  /**
   * Whether the recorder closed it cleanly.
   *
   * False means the tab died mid-recording. The audio up to that point is still
   * there and still playable, which is the entire reason for writing it as it
   * arrives — so this is offered for recovery, not treated as corrupt.
   */
  complete: boolean;
  updatedAt: string;
}

interface Manifest {
  mimeType: string;
  complete: boolean;
  /** One entry per chunk, so `bytes` never requires reading the audio back. */
  chunkBytes: number[];
  updatedAt: string;
}

function parseManifest(json: string | null): Manifest | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const manifest = parsed as Partial<Manifest>;
    return {
      mimeType: typeof manifest.mimeType === 'string' ? manifest.mimeType : 'audio/webm',
      complete: manifest.complete === true,
      chunkBytes: Array.isArray(manifest.chunkBytes) ? manifest.chunkBytes : [],
      updatedAt: typeof manifest.updatedAt === 'string' ? manifest.updatedAt : '',
    };
  } catch {
    // A corrupt manifest must not hide the audio beside it: the chunks are the
    // recording, and this file is only bookkeeping.
    return null;
  }
}

/** Appends to one capture's audio. One writer per recording, held by the recorder. */
export interface AudioWriter {
  /** Persist one chunk. Resolves once it is durable, so the caller can drop it. */
  write(chunk: Uint8Array): Promise<void>;
  /** Mark the recording finished. */
  close(): Promise<void>;
  /** How many bytes have been written so far. */
  readonly bytes: number;
}

/**
 * The identifier a capture row stores for browser-held audio.
 *
 * Deliberately not a URL. A row that held a `blob:` URL looked valid and resolved
 * to nothing after a reload; a row holding this resolves through the store, which
 * either has the audio or honestly does not.
 */
export function audioRef(captureId: string): string {
  return `audio:${captureId}`;
}

export function captureIdOfRef(ref: string): string | null {
  return ref.startsWith('audio:') ? ref.slice('audio:'.length) : null;
}

export class AudioArtifactStore {
  constructor(
    private readonly backend: ChunkBackend,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Begin (or continue) writing a capture's audio.
   *
   * Continues rather than truncates when chunks already exist: a recording that
   * was interrupted and is being resumed must not throw away what it already had,
   * and the next index is derived from what is stored rather than remembered by
   * the caller — the caller is exactly the thing that just died.
   */
  async open(captureId: string, mimeType: string): Promise<AudioWriter> {
    const existing = parseManifest(await this.backend.readManifest(captureId));
    const chunkBytes = existing?.chunkBytes ?? [];
    const indices = await this.backend.indices(captureId);
    let next = indices.length === 0 ? 0 : Math.max(...indices) + 1;

    const manifest: Manifest = {
      mimeType,
      complete: false,
      chunkBytes: [...chunkBytes],
      updatedAt: this.now(),
    };
    await this.backend.writeManifest(captureId, JSON.stringify(manifest));

    const store = this;
    return {
      get bytes() {
        return manifest.chunkBytes.reduce((total, size) => total + size, 0);
      },
      async write(chunk: Uint8Array): Promise<void> {
        if (chunk.byteLength === 0) return;
        await store.backend.put(captureId, next, chunk);
        next += 1;
        manifest.chunkBytes.push(chunk.byteLength);
        manifest.updatedAt = store.now();
        // Rewritten per chunk, and it is worth it: this is what tells a cold
        // start that a recording exists and how much of it survived.
        await store.backend.writeManifest(captureId, JSON.stringify(manifest));
      },
      async close(): Promise<void> {
        manifest.complete = true;
        manifest.updatedAt = store.now();
        await store.backend.writeManifest(captureId, JSON.stringify(manifest));
      },
    };
  }

  /** What is stored for a capture, or null when nothing is. */
  async describe(captureId: string): Promise<AudioArtifact | null> {
    const manifest = parseManifest(await this.backend.readManifest(captureId));
    const indices = await this.backend.indices(captureId);
    if (!manifest && indices.length === 0) return null;

    return {
      captureId,
      mimeType: manifest?.mimeType ?? 'audio/webm',
      // Counted from the chunks themselves rather than from the manifest: a
      // manifest write that did not survive a crash would otherwise make the
      // recording look shorter than it is.
      chunkCount: indices.length,
      bytes: (manifest?.chunkBytes ?? []).slice(0, indices.length).reduce((a, b) => a + b, 0),
      complete: manifest?.complete ?? false,
      updatedAt: manifest?.updatedAt ?? '',
    };
  }

  /** Every recording this device is holding. */
  async list(): Promise<AudioArtifact[]> {
    const captures = await this.backend.captures();
    const described = await Promise.all(captures.map((captureId) => this.describe(captureId)));
    return described.filter((artifact): artifact is AudioArtifact => artifact !== null);
  }

  /**
   * Recordings a process died in the middle of.
   *
   * What the recovery affordance lists. They are playable and transcribable; the
   * only thing missing is the recorder's own "I finished".
   */
  async interrupted(): Promise<AudioArtifact[]> {
    return (await this.list()).filter(
      (artifact) => !artifact.complete && artifact.chunkCount > 0,
    );
  }

  /**
   * The whole recording, in order.
   *
   * The one operation that is inherently memory-hungry, which is why it is a
   * separate call made on demand rather than something the recorder does as it
   * goes. Chunks are read in index order and not in the order the backend
   * happened to list them — audio concatenated out of order is noise.
   */
  async readAll(captureId: string): Promise<Uint8Array[]> {
    const indices = (await this.backend.indices(captureId)).sort((a, b) => a - b);
    const chunks: Uint8Array[] = [];
    for (const index of indices) chunks.push(await this.backend.read(captureId, index));
    return chunks;
  }

  /** Forget a recording completely. */
  async remove(captureId: string): Promise<void> {
    await this.backend.remove(captureId);
  }
}
