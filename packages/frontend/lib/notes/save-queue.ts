/** Serial local writes: creation finishes before edits, and failed writes remain retryable. */
export class NoteSaveQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private takeoverPending = false;
  private generation = 0;

  constructor(private readonly write: (draft: T, takeOverBody: boolean) => Promise<void>) {}

  /** Drop queued edits when their editor/account is no longer mounted. */
  cancelPending(): void {
    this.generation++;
  }

  save(draft: T, takeOverBody = false): Promise<void> {
    const generation = this.generation;
    const result = this.tail.then(async () => {
      if (generation !== this.generation) throw new Error("The editor was closed before this write could start");
      this.takeoverPending ||= takeOverBody;
      await this.write(draft, this.takeoverPending);
      this.takeoverPending = false;
    });
    // A failed write must not poison the chain. Its caller still gets the
    // rejection; the next edit/retry can save the complete latest draft.
    this.tail = result.catch(() => {});
    return result;
  }
}
