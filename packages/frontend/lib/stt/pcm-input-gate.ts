/**
 * Experimental callback guard. Sealing prevents late native events from calling
 * a closed writer. A native stop-and-drain barrier is still needed to know that
 * a sealed event is not part of the recording before publishing a reference.
 */
export class PcmInputGate {
  private sealed = false;
  private late = false;

  constructor(private readonly append: (bytes: Uint8Array) => void) {}

  accept(bytes: Uint8Array): void {
    if (this.sealed) {
      this.late = true;
      return;
    }
    this.append(bytes);
  }

  seal(): void {
    this.sealed = true;
  }

  assertNoLateData(): void {
    if (this.late) throw new Error('Audio arrived after the input was sealed');
  }
}
