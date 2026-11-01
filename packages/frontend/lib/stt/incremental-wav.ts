/** A reserved file handle. Implementations must not reopen a pathname. */
export interface ReservedWavFile {
  writeAt(offset: number, data: Uint8Array): Promise<number>;
  size(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Experimental bounded-memory writer for 16 kHz, mono, 16-bit PCM.
 * The caller must reserve the file exclusively and coordinate the account
 * lifecycle and database commit; this class cannot establish either property.
 */
export class IncrementalWavWriter {
  private queue = Promise.resolve();
  private pendingBytes = 0;
  private dataBytes = 0;
  private failure: unknown;
  private state: 'open' | 'finishing' | 'closed' = 'open';

  private constructor(
    private readonly file: ReservedWavFile,
    private readonly maxPendingBytes: number,
  ) {}

  static async create(
    file: ReservedWavFile,
    maxPendingBytes: number,
  ): Promise<IncrementalWavWriter> {
    if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0)
      throw new Error('Invalid WAV queue limit');
    const writer = new IncrementalWavWriter(file, maxPendingBytes);
    try {
      if ((await file.size()) !== 0) throw new Error('Reserved WAV file is not empty');
      await writer.writeExactly(0, wavHeader(0));
      return writer;
    } catch (error) {
      await file.close().catch(() => undefined);
      throw error;
    }
  }

  append(samples: Uint8Array): void {
    if (this.state !== 'open') throw new Error('WAV writer is not open');
    if (this.failure) return;
    if (samples.length % 2 || this.pendingBytes + samples.length > this.maxPendingBytes) {
      this.failure = new Error('Invalid audio or WAV queue capacity exceeded');
      return;
    }
    const copy = samples.slice();
    this.pendingBytes += copy.length;
    this.queue = this.queue.then(async () => {
      try {
        if (this.failure) return;
        if (this.dataBytes + copy.length > 0xffffffff - 36)
          throw new Error('WAV size limit exceeded');
        await this.writeExactly(44 + this.dataBytes, copy);
        this.dataBytes += copy.length;
      } catch (error) {
        this.failure ??= asError(error);
      } finally {
        this.pendingBytes -= copy.length;
      }
    });
  }

  async finish(assertOwner: () => void): Promise<number> {
    if (this.state !== 'open') throw new Error('WAV writer is not open');
    this.state = 'finishing';
    let result: number | undefined;
    try {
      await this.queue;
      if (this.failure) throw this.failure;
      assertOwner();
      if (this.dataBytes === 0 || (await this.file.size()) !== 44 + this.dataBytes)
        throw new Error('Incomplete WAV recording');
      await this.writeExactly(0, wavHeader(this.dataBytes));
      if ((await this.file.size()) !== 44 + this.dataBytes)
        throw new Error('Incomplete WAV recording');
      result = this.dataBytes;
    } catch (error) {
      this.failure ??= asError(error);
    }
    try {
      await this.file.close();
      assertOwner();
    } catch (error) {
      this.failure ??= asError(error);
    } finally {
      this.state = 'closed';
    }
    if (this.failure) throw this.failure;
    return result as number;
  }

  async cancel(): Promise<void> {
    if (this.state !== 'open') throw new Error('WAV writer is not open');
    this.state = 'finishing';
    await this.queue;
    try {
      await this.file.close();
    } finally {
      this.state = 'closed';
    }
    if (this.failure) throw this.failure;
  }

  private async writeExactly(offset: number, data: Uint8Array): Promise<void> {
    if ((await this.file.writeAt(offset, data)) !== data.length) throw new Error('Short WAV write');
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('WAV operation failed', { cause: value });
}

function wavHeader(dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const) {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  }
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, dataBytes, true);
  return bytes;
}
