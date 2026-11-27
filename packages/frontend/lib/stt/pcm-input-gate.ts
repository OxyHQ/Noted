/**
 * Experimental callback guard. Sealing prevents late native events from calling
 * a closed writer. A native stop-and-drain barrier is still needed to know that
 * a sealed event is not part of the recording before publishing a reference.
 */
export class PcmInputGate {
  private sealed = false;
  private failure: Error | undefined;

  constructor(private readonly append: (bytes: Uint8Array) => boolean) {}

  accept(bytes: Uint8Array): boolean {
    if (this.failure) return false;
    if (this.sealed) {
      this.failure ??= new Error('Audio arrived after the input was sealed');
      return false;
    }
    try {
      if (this.append(bytes)) return true;
      this.failure ??= new Error('Audio writer rejected the input');
    } catch (error) {
      this.failure ??=
        error instanceof Error ? error : new Error('Audio input failed', { cause: error });
    }
    return false;
  }

  seal(): void {
    this.sealed = true;
  }

  assertNoInputFailure(): void {
    if (this.failure) throw this.failure;
  }
}
