/**
 * Durable audio storage in a browser: OPFS, with IndexedDB behind it.
 *
 * OPFS is the right tool — it is a real file system, writes stream, and it does
 * not serialise a megabyte of audio through structured clone on every chunk. It
 * is also not everywhere, and a browser without it must still keep a recording
 * rather than silently losing one, which is what the IndexedDB path is for.
 *
 * Both are deliberately thin. Everything worth getting right — chunk ordering,
 * what a half-written recording looks like, leaving nothing behind on delete —
 * lives in `artifact-store.ts`, where it can be tested without a browser.
 */

import { createLogger } from '@oxyhq/core/logger';

import type { ChunkBackend } from '@/lib/audio/artifact-store';
import { MemoryChunkBackend } from '@/lib/audio/memory-backend';

const logger = createLogger('NotedAudio');

/** One directory, so a stray file in the origin's storage is never ours. */
const ROOT = 'noted-audio';
const MANIFEST = 'manifest.json';

/** `12` becomes `000012.bin`, so a directory listing is already in order. */
function chunkName(index: number): string {
  return `${String(index).padStart(6, '0')}.bin`;
}

function indexOfName(name: string): number | null {
  const found = /^(\d{6})\.bin$/.exec(name);
  return found ? Number(found[1]) : null;
}

/**
 * The DOM types, plus the two members this build's `lib.dom` has not caught up
 * with.
 *
 * `keys()` is how a directory is enumerated and `write` accepts a `Blob`; both
 * are in the specification and in every engine that ships OPFS. Declared as an
 * intersection rather than a hand-rolled shape, so the rest of the handle stays
 * checked against the real types.
 */
type IterableDirectory = FileSystemDirectoryHandle & {
  keys(): AsyncIterableIterator<string>;
};

type Writable = { write(data: Blob | ArrayBufferView | string): Promise<void>; close(): Promise<void> };

export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

class OpfsChunkBackend implements ChunkBackend {
  private async root(create: boolean): Promise<IterableDirectory> {
    if (!hasOpfs()) throw new Error('OPFS is not available');
    const opfs = await navigator.storage.getDirectory();
    return (await opfs.getDirectoryHandle(ROOT, { create })) as IterableDirectory;
  }

  private async capture(captureId: string, create: boolean): Promise<IterableDirectory> {
    const root = await this.root(create);
    return (await root.getDirectoryHandle(captureId, { create })) as IterableDirectory;
  }

  private async write(
    captureId: string,
    name: string,
    data: Blob | ArrayBufferView | string,
  ): Promise<void> {
    const handle = await (await this.capture(captureId, true)).getFileHandle(name, { create: true });
    const writable = (await handle.createWritable()) as unknown as Writable;
    await writable.write(data);
    await writable.close();
  }

  async put(captureId: string, index: number, chunk: Uint8Array): Promise<void> {
    await this.write(captureId, chunkName(index), chunk);
  }

  async indices(captureId: string): Promise<number[]> {
    try {
      const directory = await this.capture(captureId, false);
      const found: number[] = [];
      for await (const name of directory.keys()) {
        const index = indexOfName(name);
        if (index !== null) found.push(index);
      }
      return found;
    } catch {
      // A capture with nothing stored has no directory. That is an answer, not a
      // failure — the caller asked what is there and the answer is nothing.
      return [];
    }
  }

  async read(captureId: string, index: number): Promise<Uint8Array> {
    const handle = await (await this.capture(captureId, false)).getFileHandle(chunkName(index));
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async captures(): Promise<string[]> {
    try {
      const root = await this.root(false);
      const found: string[] = [];
      for await (const name of root.keys()) found.push(name);
      return found;
    } catch {
      return [];
    }
  }

  async readManifest(captureId: string): Promise<string | null> {
    try {
      const handle = await (await this.capture(captureId, false)).getFileHandle(MANIFEST);
      return await (await handle.getFile()).text();
    } catch {
      return null;
    }
  }

  async writeManifest(captureId: string, json: string): Promise<void> {
    await this.write(captureId, MANIFEST, json);
  }

  async remove(captureId: string): Promise<void> {
    try {
      await (await this.root(false)).removeEntry(captureId, { recursive: true });
    } catch {
      // Already gone. Deleting a recording twice is not an error.
    }
  }
}

/* ── IndexedDB, for browsers without OPFS ──────────────────────── */

const DB_NAME = 'noted-audio';
const DB_VERSION = 1;
const CHUNKS = 'chunks';
const MANIFESTS = 'manifests';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Composite key, so a chunk is addressable without an index and a whole
      // capture is one bounded range to delete.
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: ['captureId', 'index'] });
      }
      if (!db.objectStoreNames.contains(MANIFESTS)) {
        db.createObjectStore(MANIFESTS, { keyPath: 'captureId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open the audio database'));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('audio storage request failed'));
  });
}

/** Everything for one capture: `['id', 0]` up to `['id', ∞)`. */
function captureRange(captureId: string): IDBKeyRange {
  return IDBKeyRange.bound([captureId, -Infinity], [captureId, Infinity]);
}

class IndexedDbChunkBackend implements ChunkBackend {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= openDatabase();
    return this.db;
  }

  private async run<T>(
    store: string,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return promisify(work(db.transaction(store, mode).objectStore(store)));
  }

  async put(captureId: string, index: number, chunk: Uint8Array): Promise<void> {
    // Copied out of the caller's buffer: structured clone happens when the
    // transaction commits, not when `put` is called, and a recorder reusing its
    // buffer would otherwise store whatever it contained by then.
    await this.run(CHUNKS, 'readwrite', (store) =>
      store.put({ captureId, index, chunk: new Uint8Array(chunk) }),
    );
  }

  async indices(captureId: string): Promise<number[]> {
    const keys = await this.run<IDBValidKey[]>(CHUNKS, 'readonly', (store) =>
      store.getAllKeys(captureRange(captureId)),
    );
    return keys
      .map((key) => (Array.isArray(key) ? Number(key[1]) : Number.NaN))
      .filter((index) => Number.isFinite(index));
  }

  async read(captureId: string, index: number): Promise<Uint8Array> {
    const row = await this.run<{ chunk: Uint8Array } | undefined>(CHUNKS, 'readonly', (store) =>
      store.get([captureId, index]),
    );
    if (!row) throw new Error(`no chunk ${String(index)} for ${captureId}`);
    return row.chunk;
  }

  async captures(): Promise<string[]> {
    const keys = await this.run<IDBValidKey[]>(CHUNKS, 'readonly', (store) => store.getAllKeys());
    const manifests = await this.run<IDBValidKey[]>(MANIFESTS, 'readonly', (store) =>
      store.getAllKeys(),
    );
    return [
      ...new Set([
        ...keys.map((key) => (Array.isArray(key) ? String(key[0]) : String(key))),
        ...manifests.map((key) => String(key)),
      ]),
    ];
  }

  async readManifest(captureId: string): Promise<string | null> {
    const row = await this.run<{ json: string } | undefined>(MANIFESTS, 'readonly', (store) =>
      store.get(captureId),
    );
    return row?.json ?? null;
  }

  async writeManifest(captureId: string, json: string): Promise<void> {
    await this.run(MANIFESTS, 'readwrite', (store) => store.put({ captureId, json }));
  }

  async remove(captureId: string): Promise<void> {
    await this.run(CHUNKS, 'readwrite', (store) => store.delete(captureRange(captureId)));
    await this.run(MANIFESTS, 'readwrite', (store) => store.delete(captureId));
  }
}

/**
 * The best storage this browser has.
 *
 * Memory last, and it is not a silent degradation — it is logged, because a
 * recording that will not survive a reload is a real limitation the rest of the
 * app has to be able to say out loud.
 */
export function createChunkBackend(): ChunkBackend {
  if (hasOpfs()) return new OpfsChunkBackend();
  if (typeof indexedDB !== 'undefined') {
    logger.info('No OPFS here; audio is stored in IndexedDB');
    return new IndexedDbChunkBackend();
  }
  logger.warn('No durable storage here; audio will not survive a reload');
  return new MemoryChunkBackend();
}
