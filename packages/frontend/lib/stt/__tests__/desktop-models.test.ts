import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

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

function verifyingRust(prefix: Uint8Array, expected: Uint8Array) {
  let partial = Buffer.from(prefix);
  let committed = false;
  const calls: string[] = [];
  const hash = createHash('sha256').update(expected).digest('hex');
  const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    calls.push(command);
    if (command === 'model_status') return (committed ? expected.length : null) as T;
    if (command === 'model_partial') return partial.length as T;
    if (command === 'model_write') {
      const bytes = Buffer.from(String(args.chunk), 'base64');
      partial = args.reset ? bytes : Buffer.concat([partial, bytes]);
    }
    if (command === 'model_commit') {
      if (
        partial.length !== expected.length ||
        createHash('sha256').update(partial).digest('hex') !== args.sha256
      ) {
        partial = Buffer.alloc(0);
        throw new Error('sha256 mismatch');
      }
      committed = true;
    }
    return undefined as T;
  };
  return { invoke, calls, hash, partial: () => Buffer.from(partial), committed: () => committed };
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
  it('does not fetch or write when the partial size cannot be read', async () => {
    const rust = fakeRust();
    const failure = new Error('partial metadata unavailable');
    const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === 'model_partial') throw failure;
      return rust.invoke<T>(command, args);
    };
    const fetchModel = vi.fn(async () => streamOf(new Uint8Array(MODEL.bytes)));
    const models = createDesktopModels(async () => invoke, fetchModel);
    await expect(models.download(MODEL)).rejects.toBe(failure);
    expect(fetchModel).not.toHaveBeenCalled();
    expect(rust.calls.map((call) => call.command)).toEqual(['model_status']);
  });

  it('retries publishing a complete partial before fetching again', async () => {
    const rust = fakeRust(null, undefined, MODEL.bytes);
    const fetchModel = vi.fn(async () => streamOf(new Uint8Array(MODEL.bytes)));
    const progress: number[] = [];
    const models = createDesktopModels(async () => rust.invoke, fetchModel);
    await models.download(MODEL, (value) => progress.push(value));
    expect(fetchModel).not.toHaveBeenCalled();
    expect(rust.calls.map((call) => call.command)).toEqual([
      'model_status',
      'model_partial',
      'model_commit',
    ]);
    expect(progress).toEqual([1]);
  });

  it('refuses a corrupt complete partial and fetches afresh on a later retry', async () => {
    const correct = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const corrupt = new Uint8Array(10);
    const rust = verifyingRust(corrupt, correct);
    const fetchModel = vi.fn(async () => streamOf(correct));
    const models = createDesktopModels(async () => rust.invoke, fetchModel);
    const model = { ...MODEL, sha256: rust.hash };
    await expect(models.download(model)).rejects.toThrow('sha256 mismatch');
    expect(fetchModel).not.toHaveBeenCalled();
    expect(rust.partial()).toHaveLength(0);
    await models.download(model);
    expect(fetchModel).toHaveBeenCalledOnce();
    expect(rust.committed()).toBe(true);
  });

  it.each(['pending', 'rejected'] as const)(
    'requests cancellation of an HTTP error body without waiting when cancellation is %s',
    async (cancelOutcome) => {
      const rust = fakeRust();
      let cancelled = false;
      let release!: () => void;
      const cancellation = new Promise<void>((resolve) => {
        release = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
          return cancelOutcome === 'pending'
            ? cancellation
            : Promise.reject(new Error('cancel failed'));
        },
      });
      const models = createDesktopModels(
        async () => rust.invoke,
        async () => new Response(body, { status: 503 }),
      );
      try {
        await expect(models.download(MODEL)).rejects.toThrow('HTTP 503');
        expect(cancelled).toBe(true);
        expect(rust.calls.map((call) => call.command)).toEqual(['model_status', 'model_partial']);
      } finally {
        release();
      }
    },
  );

  it.each([0, 4])(
    'rejects an oversized HTTP 200 before writing beyond the model size (partial=%i)',
    async (partial) => {
      const rust = fakeRust(null, undefined, partial);
      let cancelled = false;
      let part = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (part++ === 0) controller.enqueue(new Uint8Array(CHUNK_BYTES));
            else if (part === 2) controller.enqueue(new Uint8Array(4));
            else controller.close();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const models = createDesktopModels(
        async () => rust.invoke,
        async () => new Response(body),
      );
      await expect(models.download({ ...MODEL, bytes: CHUNK_BYTES + 3 })).rejects.toThrow(
        'model download exceeds its expected size',
      );
      expect(cancelled).toBe(true);
      const writes = rust.calls.filter((call) => call.command === 'model_write');
      expect(writes.map((write) => decodeLen(write.args.chunk))).toEqual([CHUNK_BYTES]);
      expect(writes[0].args.reset).toBe(true);
      expect(rust.calls.some((call) => call.command === 'model_commit')).toBe(false);
    },
  );

  it('reports a write failure even when stream cancellation does not settle', async () => {
    const failure = new Error('disk write failed');
    let releaseCancel!: () => void;
    let signalCancel!: () => void;
    const cancelCalled = new Promise<void>((resolve) => {
      signalCancel = resolve;
    });
    const cancellation = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CHUNK_BYTES));
      },
      cancel() {
        signalCancel();
        return cancellation;
      },
    });
    const rust = fakeRust();
    const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
      if (command === 'model_write') throw failure;
      return rust.invoke<T>(command, args);
    };
    const models = createDesktopModels(
      async () => invoke,
      async () => new Response(body),
    );
    const result = models.download({ ...MODEL, bytes: CHUNK_BYTES + 1 }).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    try {
      await cancelCalled;
      const outcome = await Promise.race([
        result,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1000)),
      ]);
      expect(outcome).toBe(failure);
      expect(rust.calls.map((call) => call.command)).not.toContain('model_commit');
    } finally {
      releaseCancel();
      await result;
    }
  });

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

  it.each([
    { partial: 0, status: 200 },
    { partial: 4, status: 206 },
  ])(
    'bounds oversized stream chunks (partial=$partial, status=$status)',
    async ({ partial, status }) => {
      const size = CHUNK_BYTES * 2 + 5;
      const body = new Uint8Array(size);
      for (let i = 0; i < body.length; i += 1) body[i] = i % 251;
      const rust = fakeRust(null, undefined, partial);
      const requests: Array<RequestInit | undefined> = [];
      const models = createDesktopModels(
        async () => rust.invoke,
        async (_url, init) => {
          requests.push(init);
          return new Response(streamOf(body).body, {
            status,
            headers: partial
              ? { 'Content-Range': `bytes ${partial}-${size + partial - 1}/${size + partial}` }
              : {},
          });
        },
      );
      await models.download({ ...MODEL, bytes: size + partial });
      expect(requests[0]?.headers).toEqual(partial ? { Range: `bytes=${partial}-` } : undefined);
      const writes = rust.calls.filter((call) => call.command === 'model_write');
      expect(writes.map((write) => decodeLen(write.args.chunk))).toEqual([
        CHUNK_BYTES,
        CHUNK_BYTES,
        5,
      ]);
      expect(writes.map((write) => write.args.reset)).toEqual([partial === 0, false, false]);
      const received = Buffer.concat(
        writes.map((write) => Buffer.from(String(write.args.chunk), 'base64')),
      );
      expect(received.equals(Buffer.from(body))).toBe(true);
    },
  );

  it('preserves order when a read crosses a chunk boundary', async () => {
    const first = new Uint8Array(CHUNK_BYTES - 2).fill(17);
    const second = new Uint8Array([1, 2, 3, 4, 5]);
    const rust = fakeRust();
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => streamOf(first, second),
    );
    await models.download({ ...MODEL, bytes: first.length + second.length });
    const writes = rust.calls.filter((call) => call.command === 'model_write');
    expect(writes.map((write) => decodeLen(write.args.chunk))).toEqual([CHUNK_BYTES, 3]);
    const received = Buffer.concat(
      writes.map((write) => Buffer.from(String(write.args.chunk), 'base64')),
    );
    expect(received.equals(Buffer.concat([Buffer.from(first), Buffer.from(second)]))).toBe(true);
  });

  it('does not let the producer reuse a pending chunk buffer before flush', async () => {
    const shared = new Uint8Array([1, 2]);
    let step = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (step++ === 0) controller.enqueue(shared);
          else if (step === 2) {
            shared.fill(9);
            controller.enqueue(new Uint8Array([3]));
          } else controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const rust = fakeRust();
    const models = createDesktopModels(
      async () => rust.invoke,
      async () => new Response(stream),
    );
    await models.download({ ...MODEL, bytes: 3 });
    const write = rust.calls.find((call) => call.command === 'model_write');
    expect([...Buffer.from(String(write?.args.chunk), 'base64')]).toEqual([1, 2, 3]);
  });

  it('cancels the stream and never commits when a later bounded write fails', async () => {
    const rust = fakeRust();
    let writeCount = 0;
    let cancelled = false;
    const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
      if (command === 'model_write' && ++writeCount === 2) throw new Error('disk unavailable');
      return rust.invoke<T>(command, args);
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CHUNK_BYTES * 2 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const models = createDesktopModels(
      async () => invoke,
      async () => new Response(body),
    );
    await expect(models.download({ ...MODEL, bytes: CHUNK_BYTES * 2 + 1 })).rejects.toThrow(
      'disk unavailable',
    );
    expect(cancelled).toBe(true);
    expect(writeCount).toBe(2);
    expect(rust.calls.some((call) => call.command === 'model_commit')).toBe(false);
    expect(rust.calls.some((call) => call.command === 'model_remove')).toBe(false);
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
        return new Response(streamOf(new Uint8Array(6)).body, {
          status: 206,
          headers: { 'Content-Range': 'bytes 4-9/10' },
        });
      },
    );
    await models.download(MODEL);
    expect(seen[0]?.headers).toEqual({ Range: 'bytes=4-' });
    const write = rust.calls.find((c) => c.command === 'model_write');
    expect(write?.args.reset).toBe(false);
    expect(decodeLen(write?.args.chunk)).toBe(6);
  });

  it('preserves the existing partial if a 206 starts at the wrong byte', async () => {
    const original = Buffer.from([1, 2, 3, 4]);
    let partial = Buffer.from(original);
    const whole = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const calls: string[] = [];
    const invoke: Invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
      calls.push(command);
      if (command === 'model_status') return null as T;
      if (command === 'model_partial') return partial.length as T;
      if (command === 'model_write') {
        const bytes = Buffer.from(String(args.chunk), 'base64');
        partial = args.reset ? bytes : Buffer.concat([partial, bytes]);
      }
      if (command === 'model_commit') {
        const actual = createHash('sha256').update(partial).digest('hex');
        if (partial.length !== whole.length || actual !== args.sha256) {
          partial = Buffer.alloc(0); // Rust commit removes a failed partial.
          throw new Error('sha256 mismatch');
        }
      }
      return undefined as T;
    };
    const models = createDesktopModels(
      async () => invoke,
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-5/10' },
        }),
    );
    await expect(
      models.download({ ...MODEL, sha256: createHash('sha256').update(whole).digest('hex') }),
    ).rejects.toThrow();
    expect(partial.equals(original)).toBe(true);
    expect(calls).not.toContain('model_write');
    expect(calls).not.toContain('model_commit');
  });

  it.each([
    null,
    '',
    'bytes */10',
    'bytes 3-9/10',
    'bytes 5-9/10',
    'bytes 4-10/11',
    'bytes 4-9/11',
    'bytes 999999999999999999999-999999999999999999999/*',
  ])('rejects inconsistent or unavailable Content-Range %s before writing', async (range) => {
    const rust = fakeRust(null, undefined, 4);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const models = createDesktopModels(
      async () => rust.invoke,
      async () =>
        new Response(body, {
          status: 206,
          headers: range === null ? {} : { 'Content-Range': range },
        }),
    );
    await expect(models.download(MODEL)).rejects.toThrow('invalid Content-Range');
    expect(cancelled).toBe(true);
    expect(rust.calls.some((call) => call.command === 'model_write')).toBe(false);
    expect(rust.calls.some((call) => call.command === 'model_commit')).toBe(false);
  });

  it('accepts a valid full remainder when the total is unspecified', async () => {
    const rust = fakeRust(null, undefined, 4);
    const models = createDesktopModels(
      async () => rust.invoke,
      async () =>
        new Response(streamOf(new Uint8Array(6)).body, {
          status: 206,
          headers: { 'Content-Range': 'bytes 4-9/*' },
        }),
    );
    await models.download(MODEL);
    const write = rust.calls.find((call) => call.command === 'model_write');
    expect(write?.args.reset).toBe(false);
    expect(decodeLen(write?.args.chunk)).toBe(6);
    expect(rust.calls.at(-1)?.command).toBe('model_commit');
  });

  it('retains a short body without committing and resumes it on a later attempt', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const rust = verifyingRust(expected.subarray(0, 4), expected);
    const requests: Array<RequestInit | undefined> = [];
    let response = 0;
    const models = createDesktopModels(
      async () => rust.invoke,
      async (_url, init) => {
        requests.push(init);
        return response++ === 0
          ? new Response(new Uint8Array([5, 6]), {
              status: 206,
              headers: { 'Content-Range': 'bytes 4-9/10' },
            })
          : new Response(new Uint8Array([7, 8, 9, 10]), {
              status: 206,
              headers: { 'Content-Range': 'bytes 6-9/10' },
            });
      },
    );
    const model = { ...MODEL, sha256: rust.hash };
    await expect(models.download(model)).rejects.toThrow('ended before its Content-Range');
    expect([...rust.partial()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rust.calls).not.toContain('model_commit');
    await models.download(model);
    expect(requests.map((r) => r?.headers)).toEqual([{ Range: 'bytes=4-' }, { Range: 'bytes=6-' }]);
    expect([...rust.partial()]).toEqual([...expected]);
    expect(rust.committed()).toBe(true);
  });

  it('retains an HTTP-valid partial segment and completes after a later retry', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const rust = verifyingRust(expected.subarray(0, 4), expected);
    let response = 0;
    const models = createDesktopModels(
      async () => rust.invoke,
      async () =>
        response++ === 0
          ? new Response(new Uint8Array([5, 6, 7]), {
              status: 206,
              headers: { 'Content-Range': 'bytes 4-6/10' },
            })
          : new Response(new Uint8Array([8, 9, 10]), {
              status: 206,
              headers: { 'Content-Range': 'bytes 7-9/10' },
            }),
    );
    const model = { ...MODEL, sha256: rust.hash };
    await expect(models.download(model)).rejects.toThrow('incomplete');
    expect([...rust.partial()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rust.calls).not.toContain('model_commit');
    await models.download(model);
    expect([...rust.partial()]).toEqual([...expected]);
    expect(rust.committed()).toBe(true);
  });

  it('resumes an HTTP partial segment from a real loopback server', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const rust = verifyingRust(expected.subarray(0, 4), expected);
    const ranges: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      ranges.push(request.headers.range);
      const first = request.headers.range === 'bytes=4-';
      response.writeHead(206, { 'Content-Range': first ? 'bytes 4-6/10' : 'bytes 7-9/10' });
      response.end(Buffer.from(first ? [5, 6, 7] : [8, 9, 10]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing test server address');
      const models = createDesktopModels(async () => rust.invoke);
      const model = { ...MODEL, url: `http://127.0.0.1:${address.port}/model`, sha256: rust.hash };
      await expect(models.download(model)).rejects.toThrow('incomplete');
      expect([...rust.partial()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
      await models.download(model);
      expect(ranges).toEqual(['bytes=4-', 'bytes=7-']);
      expect(rust.committed()).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects a body exceeding its declared range before writing it', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const rust = verifyingRust(expected.subarray(0, 4), expected);
    const models = createDesktopModels(
      async () => rust.invoke,
      async () =>
        new Response(new Uint8Array([5, 6, 7, 8]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 4-6/10' },
        }),
    );
    await expect(models.download({ ...MODEL, sha256: rust.hash })).rejects.toThrow('exceeds');
    expect([...rust.partial()]).toEqual([1, 2, 3, 4]);
    expect(rust.calls).not.toContain('model_write');
    expect(rust.calls).not.toContain('model_commit');
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
