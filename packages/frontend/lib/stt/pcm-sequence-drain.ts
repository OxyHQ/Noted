/**
 * Experiment for a native protocol that numbers PCM events per operation.
 * No existing native recorder currently provides this protocol.
 */
export class PcmSequenceDrain {
  private next = 0;
  private bufferedBytes = 0;
  private readonly pending = new Map<number, Uint8Array>();
  private last: number | undefined;
  private failure: Error | undefined;
  private settled = false;
  private resolve: (() => void) | undefined;
  private reject: ((error: Error) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly operationId: string,
    private readonly maxBufferedBytes: number,
    private readonly deliver: (bytes: Uint8Array) => void,
  ) {
    if (!operationId || !Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0)
      throw new Error('Invalid PCM drain configuration');
  }

  receive(operationId: string, sequence: number, bytes: Uint8Array): boolean {
    if (this.failure) return false;
    if (
      this.settled ||
      operationId !== this.operationId ||
      !Number.isSafeInteger(sequence) ||
      sequence < this.next ||
      sequence >= Number.MAX_SAFE_INTEGER ||
      bytes.length === 0 ||
      this.pending.has(sequence) ||
      (this.last !== undefined && sequence > this.last) ||
      this.bufferedBytes + bytes.length > this.maxBufferedBytes
    ) {
      this.fail(new Error('Invalid, duplicate, late, or excessive PCM event'));
      return false;
    }
    this.pending.set(sequence, bytes.slice());
    this.bufferedBytes += bytes.length;
    try {
      while (this.pending.has(this.next)) {
        const current = this.pending.get(this.next) as Uint8Array;
        this.pending.delete(this.next);
        this.bufferedBytes -= current.length;
        this.deliver(current);
        this.next++;
      }
      this.maybeResolve();
      return true;
    } catch (error) {
      this.fail(
        error instanceof Error ? error : new Error('PCM delivery failed', { cause: error }),
      );
      return false;
    }
  }

  waitForStop(last: number, timeoutMs: number): Promise<void> {
    if (
      this.last !== undefined ||
      !Number.isSafeInteger(last) ||
      last < -1 ||
      last >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    )
      return Promise.reject(new Error('Invalid PCM stop marker'));
    if (this.failure) return Promise.reject(this.failure);
    this.last = last;
    if (last < this.next - 1 || [...this.pending.keys()].some((sequence) => sequence > last))
      return Promise.reject(this.fail(new Error('PCM stop marker precedes an event')));
    const result = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.timer = setTimeout(() => this.fail(new Error('PCM drain timed out')), timeoutMs);
    });
    this.maybeResolve();
    return result;
  }

  private maybeResolve(): void {
    if (this.last === undefined || this.next !== this.last + 1 || this.failure) return;
    this.settled = true;
    if (this.timer) clearTimeout(this.timer);
    this.resolve?.();
  }

  private fail(error: Error): Error {
    this.failure ??= error;
    if (this.timer) clearTimeout(this.timer);
    this.reject?.(this.failure);
    return this.failure;
  }
}
