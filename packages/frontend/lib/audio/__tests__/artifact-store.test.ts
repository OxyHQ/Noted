import { describe, expect, it } from 'vitest';

import { AudioArtifactStore, audioRef, captureIdOfRef } from '@/lib/audio/artifact-store';
import { MemoryChunkBackend } from '@/lib/audio/memory-backend';

const CAPTURE_ID = 'cap_1';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function build(): { store: AudioArtifactStore; backend: MemoryChunkBackend } {
  const backend = new MemoryChunkBackend();
  let tick = 0;
  return {
    backend,
    store: new AudioArtifactStore(backend, () => {
      tick += 1;
      return `2026-08-10T10:00:0${String(tick)}.000Z`;
    }),
  };
}

describe('the durable reference', () => {
  it('is not a URL, because a URL is exactly what stopped working', () => {
    // A row holding a `blob:` URL looked valid and resolved to nothing after a
    // reload. This resolves through the store, which either has the audio or
    // honestly does not.
    expect(audioRef(CAPTURE_ID)).toBe('audio:cap_1');
    expect(audioRef(CAPTURE_ID).startsWith('blob:')).toBe(false);
  });

  it('round-trips', () => {
    expect(captureIdOfRef(audioRef(CAPTURE_ID))).toBe(CAPTURE_ID);
  });

  it('says nothing about a path that is not one of ours', () => {
    // Native rows hold a filesystem path, and reading one as a capture id would
    // point playback at a recording that does not exist.
    expect(captureIdOfRef('captures/cap_1/audio.wav')).toBeNull();
    expect(captureIdOfRef('blob:http://localhost/abc')).toBeNull();
  });
});

describe('writing as the recording runs', () => {
  it('keeps every chunk, in the order it was written', async () => {
    const { store } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes(1, 2));
    await writer.write(bytes(3, 4, 5));
    await writer.close();

    expect(await store.readAll(CAPTURE_ID)).toEqual([bytes(1, 2), bytes(3, 4, 5)]);
  });

  it('reads chunks in index order, not in whatever order storage lists them', async () => {
    // Audio concatenated out of order is noise, and a directory listing is under
    // no obligation to be sorted.
    const { store, backend } = build();
    await backend.put(CAPTURE_ID, 2, bytes(3));
    await backend.put(CAPTURE_ID, 0, bytes(1));
    await backend.put(CAPTURE_ID, 1, bytes(2));

    expect(await store.readAll(CAPTURE_ID)).toEqual([bytes(1), bytes(2), bytes(3)]);
  });

  it('reports how much has been written without reading it back', async () => {
    const { store } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes(1, 2, 3));
    await writer.write(bytes(4));
    expect(writer.bytes).toBe(4);

    const artifact = await store.describe(CAPTURE_ID);
    expect(artifact).toMatchObject({ bytes: 4, chunkCount: 2, mimeType: 'audio/webm' });
  });

  it('ignores an empty chunk rather than storing a hole', async () => {
    const { store } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes());
    await writer.write(bytes(1));
    expect((await store.describe(CAPTURE_ID))?.chunkCount).toBe(1);
  });

  it('does not hand the store a buffer the recorder can rewrite', async () => {
    // A recorder reusing one buffer would otherwise silently overwrite audio it
    // had already "stored".
    const { store } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    const reused = bytes(1, 2);
    await writer.write(reused);
    reused[0] = 99;
    expect((await store.readAll(CAPTURE_ID))[0]).toEqual(bytes(1, 2));
  });
});

describe('a tab that died mid-recording', () => {
  it('keeps what it had', async () => {
    const { store } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes(1, 2));
    // …and nothing calls `close`, because the page is gone.

    const artifact = await store.describe(CAPTURE_ID);
    expect(artifact?.complete).toBe(false);
    expect(artifact?.chunkCount).toBe(1);
    expect(await store.readAll(CAPTURE_ID)).toEqual([bytes(1, 2)]);
  });

  it('offers it for recovery, and does not offer a finished one', async () => {
    const { store } = build();
    const abandoned = await store.open('cap_dead', 'audio/webm');
    await abandoned.write(bytes(1));

    const finished = await store.open('cap_done', 'audio/webm');
    await finished.write(bytes(2));
    await finished.close();

    expect((await store.interrupted()).map((artifact) => artifact.captureId)).toEqual(['cap_dead']);
  });

  it('resumes by appending rather than starting again', async () => {
    // The caller that knew which chunk came next is exactly the thing that died,
    // so the next index comes from what is stored.
    const { store } = build();
    const first = await store.open(CAPTURE_ID, 'audio/webm');
    await first.write(bytes(1));

    const resumed = await store.open(CAPTURE_ID, 'audio/webm');
    await resumed.write(bytes(2));
    await resumed.close();

    expect(await store.readAll(CAPTURE_ID)).toEqual([bytes(1), bytes(2)]);
  });

  it('does not report audio the manifest never recorded as missing', async () => {
    // A manifest write that did not survive the crash would otherwise make the
    // recording look shorter than it is. The chunks are the recording.
    const { store, backend } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes(1));
    await backend.put(CAPTURE_ID, 9, bytes(2, 3));

    expect((await store.describe(CAPTURE_ID))?.chunkCount).toBe(2);
  });

  it('still reads the audio when the manifest is corrupt', async () => {
    const { store, backend } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes(1, 2));
    await backend.writeManifest(CAPTURE_ID, 'not json at all');

    const artifact = await store.describe(CAPTURE_ID);
    expect(artifact?.chunkCount).toBe(1);
    expect(await store.readAll(CAPTURE_ID)).toEqual([bytes(1, 2)]);
  });
});

describe('listing and deleting', () => {
  it('lists every recording the device is holding', async () => {
    const { store } = build();
    for (const id of ['a', 'b']) {
      const writer = await store.open(id, 'audio/webm');
      await writer.write(bytes(1));
      await writer.close();
    }
    expect((await store.list()).map((artifact) => artifact.captureId).sort()).toEqual(['a', 'b']);
  });

  it('says nothing at all about a capture with nothing stored', async () => {
    const { store } = build();
    expect(await store.describe('never-recorded')).toBeNull();
  });

  it('leaves nothing behind when a recording is deleted', async () => {
    // "Ensure stored browser chunks are deleted when requested" — a leftover
    // chunk is a recording the user believes they deleted.
    const { store } = build();
    const writer = await store.open(CAPTURE_ID, 'audio/webm');
    await writer.write(bytes(1));
    await writer.close();

    await store.remove(CAPTURE_ID);
    expect(await store.describe(CAPTURE_ID)).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(await store.readAll(CAPTURE_ID)).toEqual([]);
  });
});
