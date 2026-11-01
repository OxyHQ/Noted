import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IncrementalWavWriter, type ReservedWavFile } from '../incremental-wav';

class MemoryFile implements ReservedWavFile {
  bytes = new Uint8Array();
  closed = false;
  short = false;
  closeError = false;
  async writeAt(offset: number, data: Uint8Array): Promise<number> {
    const count = data.length - (this.short ? 1 : 0);
    const next = new Uint8Array(Math.max(this.bytes.length, offset + count));
    next.set(this.bytes);
    next.set(data.subarray(0, count), offset);
    this.bytes = next;
    return count;
  }
  async size(): Promise<number> {
    return this.bytes.length;
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.closeError) throw new Error('close failed');
  }
}

describe('incremental WAV prototype', () => {
  it('writes a valid WAV through a real exclusively created file descriptor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'noted-wav-test-'));
    const path = join(directory, 'audio.wav');
    try {
      const handle = await open(path, 'wx');
      await expect(open(path, 'wx')).rejects.toMatchObject({ code: 'EEXIST' });
      const writer = await IncrementalWavWriter.create(
        {
          async writeAt(offset, data) {
            return (await handle.write(data, 0, data.length, offset)).bytesWritten;
          },
          async size() {
            return (await handle.stat()).size;
          },
          async close() {
            await handle.close();
          },
        },
        1024,
      );
      writer.append(Uint8Array.of(1, 2, 3, 4));
      await writer.finish(() => {});
      const file = await readFile(path);
      expect(file.subarray(0, 4).toString()).toBe('RIFF');
      expect(file.subarray(8, 12).toString()).toBe('WAVE');
      expect(file.readUInt32LE(40)).toBe(4);
      expect([...file.subarray(44)]).toEqual([1, 2, 3, 4]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes ordered PCM and patches the header without reading the file', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    writer.append(Uint8Array.of(3, 4));
    expect(await writer.finish(() => {})).toBe(4);
    expect(Array.from(file.bytes.slice(44))).toEqual([1, 2, 3, 4]);
    expect(new DataView(file.bytes.buffer).getUint32(40, true)).toBe(4);
    expect(new DataView(file.bytes.buffer).getUint32(4, true)).toBe(40);
    expect(file.closed).toBe(true);
  });

  it('refuses to overwrite a nonempty handle even if reservation was wrong', async () => {
    const file = new MemoryFile();
    file.bytes = Uint8Array.of(1, 2, 3, 4);
    await expect(IncrementalWavWriter.create(file, 1024)).rejects.toThrow('not empty');
    expect(Array.from(file.bytes)).toEqual([1, 2, 3, 4]);
    expect(file.closed).toBe(true);
  });

  it('rejects a short append and still closes', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 1024);
    file.short = true;
    writer.append(Uint8Array.of(1, 2));
    await expect(writer.finish(() => {})).rejects.toThrow('Short WAV write');
    expect(file.closed).toBe(true);
  });

  it('rejects a failed final header update and still closes', async () => {
    const file = new MemoryFile();
    const originalWrite = file.writeAt.bind(file);
    let headerWrites = 0;
    file.writeAt = async (offset, data) => {
      if (offset === 0 && ++headerWrites === 2) throw new Error('header failed');
      return originalWrite(offset, data);
    };
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    await expect(writer.finish(() => {})).rejects.toThrow('header failed');
    expect(file.closed).toBe(true);
  });

  it('preserves the first append failure even if close also fails', async () => {
    const file = new MemoryFile();
    const originalWrite = file.writeAt.bind(file);
    file.writeAt = async (offset, data) => {
      if (offset === 44) throw new Error('disk full');
      return originalWrite(offset, data);
    };
    const writer = await IncrementalWavWriter.create(file, 1024);
    file.closeError = true;
    writer.append(Uint8Array.of(1, 2));
    await expect(writer.finish(() => {})).rejects.toThrow('disk full');
    expect(file.closed).toBe(true);
  });

  it('fails closed if the queue cannot keep up', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 2);
    writer.append(Uint8Array.of(1, 2));
    writer.append(Uint8Array.of(3, 4));
    await expect(writer.finish(() => {})).rejects.toThrow('capacity');
    expect(file.closed).toBe(true);
  });

  it('waits for an in-flight append before finishing', async () => {
    const file = new MemoryFile();
    const originalWrite = file.writeAt.bind(file);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    file.writeAt = async (offset, bytes) => {
      if (offset === 44) await blocked;
      return originalWrite(offset, bytes);
    };
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    const finished = writer.finish(() => {});
    await Promise.resolve();
    expect(file.closed).toBe(false);
    release?.();
    expect(await finished).toBe(2);
    expect(Array.from(file.bytes.slice(44))).toEqual([1, 2]);
  });

  it('rejects close failure and an account switch', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    file.closeError = true;
    await expect(writer.finish(() => {})).rejects.toThrow('close failed');
    const other = new MemoryFile();
    const next = await IncrementalWavWriter.create(other, 1024);
    next.append(Uint8Array.of(1, 2));
    await expect(
      next.finish(() => {
        throw new Error('account changed');
      }),
    ).rejects.toThrow('account changed');
    expect(other.closed).toBe(true);
  });

  it('rejects an account switch during close', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    let checks = 0;
    await expect(
      writer.finish(() => {
        if (++checks === 2) throw new Error('account changed during close');
      }),
    ).rejects.toThrow('account changed during close');
    expect(file.closed).toBe(true);
  });

  it('processes three simulated hours in bounded chunks', async () => {
    let size = 0;
    let largestWrite = 0;
    const file: ReservedWavFile = {
      async writeAt(offset, data) {
        largestWrite = Math.max(largestWrite, data.length);
        size = Math.max(size, offset + data.length);
        return data.length;
      },
      async size() {
        return size;
      },
      async close() {},
    };
    const writer = await IncrementalWavWriter.create(file, 32_000);
    const second = new Uint8Array(32_000);
    for (let i = 0; i < 10_800; i++) {
      writer.append(second);
      // Model a storage device keeping up; slower storage is tested above.
      for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    }
    expect(await writer.finish(() => {})).toBe(345_600_000);
    expect(size).toBe(345_600_044);
    expect(largestWrite).toBe(32_000);
  });

  it('closes on cancellation without publishing a reference', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    await writer.cancel();
    expect(file.closed).toBe(true);
    await expect(writer.finish(() => {})).rejects.toThrow('not open');
  });

  it('preserves a write failure if cancellation also fails to close', async () => {
    const file = new MemoryFile();
    const originalWrite = file.writeAt.bind(file);
    file.writeAt = async (offset, data) => {
      if (offset === 44) throw new Error('disk full');
      return originalWrite(offset, data);
    };
    const writer = await IncrementalWavWriter.create(file, 1024);
    file.closeError = true;
    writer.append(Uint8Array.of(1, 2));
    await expect(writer.cancel()).rejects.toThrow('disk full');
    expect(file.closed).toBe(true);
  });

  it('rejects truncation even when writes reported success', async () => {
    const file = new MemoryFile();
    const writer = await IncrementalWavWriter.create(file, 1024);
    writer.append(Uint8Array.of(1, 2));
    file.size = async () => 44;
    await expect(writer.finish(() => {})).rejects.toThrow('Incomplete');
  });
});
