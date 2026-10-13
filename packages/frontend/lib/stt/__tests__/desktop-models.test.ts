import { describe, expect, it } from 'vitest';

import type { Invoke } from '@/lib/db/desktop-driver';
import { CHUNK_BYTES, type DesktopModelInfo, createDesktopModels } from '@/lib/stt/desktop-models';
import { DESKTOP_MODEL_FILES } from '@/lib/stt/desktop-model-files';

const MODEL: DesktopModelInfo = {
  id: 'tiny',
  url: 'https://models.test/tiny.bin',
  bytes: 10,
  sha256: 'ab'.repeat(32),
};

type Call = { command: string; args: Record<string, unknown> };

function fakeRust(initial: number | null = null, onCommit?: () => Error | undefined, partial = 0) {
  const calls: Call[] = [];
  let size = initial;
  const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === 'model_status') return size as T;
    if (command === 'model_partial') return partial as T;
    if (command === 'model_commit') {
      const error = onCommit?.();
      if (error) throw error;
      size = MODEL.bytes;
    }
    if (command === 'model_remove') size = null;
    return undefined as T;
  };
  return { invoke, calls };
}

function streamOf(...parts: Uint8Array[]): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[index++];
      if (part) controller.enqueue(part);
      else controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const decodeLen = (b64: unknown) => Buffer.from(String(b64), 'base64').length;

describe('desktop model downloads', () => {
  it('reads state from the file size Rust reports, not from a flag', async () => {
    const rust = fakeRust(10);
    const models = createDesktopModels(async () => rust.invoke);
    expect(await models.stateOf(MODEL)).toBe('ready');
    expect(rust.calls[0]).toEqual({
      command: 'model_status',
      args: { name: DESKTOP_MODEL_FILES.tiny },
    });

    expect(await createDesktopModels(async () => fakeRust(4).invoke).stateOf(MODEL)).toBe('absent');
    expect(await createDesktopModels(async () => fakeRust(null).invoke).stateOf(MODEL)).toBe(
      'absent',
    );
  });

  it('streams the body to Rust, then asks it to verify against the catalogue', async () => {
    const rust = fakeRust();
    const progress: number[] = [];
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => streamOf(new Uint8Array(4).fill(1), new Uint8Array(6).fill(2)),
    );
    await models.download(MODEL, (fraction) => progress.push(fraction));

    const commands = rust.calls.map((c) => c.command);
    expect(commands).toEqual(['model_status', 'model_partial', 'model_write', 'model_commit']);
    const write = rust.calls.find((c) => c.command === 'model_write');
    expect(write?.args.reset).toBe(true);
    expect(decodeLen(write?.args.chunk)).toBe(10);
    expect(rust.calls.at(-1)).toEqual({
      command: 'model_commit',
      args: { name: DESKTOP_MODEL_FILES.tiny, bytes: 10, sha256: MODEL.sha256 },
    });
    expect(progress.at(-1)).toBe(1);
    // Never reports done before Rust has verified.
    expect(Math.max(...progress.slice(0, -1))).toBeLessThan(1);
  });

  it('splits a large body into chunks, resetting only on the first', async () => {
    const rust = fakeRust();
    const big: DesktopModelInfo = { ...MODEL, bytes: CHUNK_BYTES * 2 + 5 };
    const models = createDesktopModels(
      async () => rust.invoke,
      async () =>
        streamOf(new Uint8Array(CHUNK_BYTES), new Uint8Array(CHUNK_BYTES), new Uint8Array(5)),
    );
    await models.download(big);
    const writes = rust.calls.filter((c) => c.command === 'model_write');
    expect(writes.map((w) => w.args.reset)).toEqual([true, false, false]);
    expect(writes.reduce((n, w) => n + decodeLen(w.args.chunk), 0)).toBe(big.bytes);
  });

  it('does nothing when the model is already there', async () => {
    const rust = fakeRust(10);
    let fetched = false;
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => {
        fetched = true;
        return streamOf();
      },
    );
    await models.download(MODEL);
    expect(fetched).toBe(false);
    expect(rust.calls.map((c) => c.command)).toEqual(['model_status']);
  });

  it('rethrows when Rust rejects the hash; Rust has already deleted the bad file', async () => {
    const rust = fakeRust(null, () => new Error('sha256 mismatch'));
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => streamOf(new Uint8Array(10)),
    );
    await expect(models.download(MODEL)).rejects.toThrow('sha256 mismatch');
    expect(rust.calls.at(-1)?.command).toBe('model_commit');
  });

  it('keeps the partial file when the connection drops, so the next try resumes', async () => {
    const rust = fakeRust();
    const dropped = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
        },
        pull() {
          throw new Error('connection reset');
        },
      }),
    );
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => dropped,
    );
    await expect(models.download(MODEL)).rejects.toThrow('connection reset');
    expect(rust.calls.some((c) => c.command === 'model_remove')).toBe(false);
  });

  it('resumes from the partial size with a Range request and appends on a 206', async () => {
    const rust = fakeRust(null, undefined, 4);
    const seen: Array<RequestInit | undefined> = [];
    const models = createDesktopModels(
      async () => rust.invoke,
      async (_url, init) => {
        seen.push(init);
        return new Response(streamOf(new Uint8Array(6)).body, { status: 206 });
      },
    );
    await models.download(MODEL);
    expect(seen[0]?.headers).toEqual({ Range: 'bytes=4-' });
    const write = rust.calls.find((c) => c.command === 'model_write');
    expect(write?.args.reset).toBe(false);
    expect(decodeLen(write?.args.chunk)).toBe(6);
  });

  it('starts over when the server ignores Range and sends the whole file', async () => {
    const rust = fakeRust(null, undefined, 4);
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => streamOf(new Uint8Array(10)),
    );
    await models.download(MODEL);
    const write = rust.calls.find((c) => c.command === 'model_write');
    expect(write?.args.reset).toBe(true);
    expect(decodeLen(write?.args.chunk)).toBe(10);
  });

  it('fails on an HTTP error without writing anything', async () => {
    const rust = fakeRust();
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => new Response('no', { status: 429 }),
    );
    await expect(models.download(MODEL)).rejects.toThrow('HTTP 429');
    expect(rust.calls.some((c) => c.command === 'model_write')).toBe(false);
  });

  it('removes through Rust', async () => {
    const rust = fakeRust(10);
    await createDesktopModels(async () => rust.invoke).remove(MODEL);
    expect(rust.calls[0].command).toBe('model_remove');
  });
});
