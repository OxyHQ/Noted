/** Only models browser lock exclusion/ifAvailable; no database behavior. */
export function createLockManager() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async request<T>(
      name: string,
      optionsOrWork: LockOptions | ((lock: { name: string }) => T),
      callback?: (lock: { name: string } | null) => T,
    ): Promise<Awaited<T>> {
      const options = typeof optionsOrWork === 'function' ? {} : optionsOrWork;
      const work = (typeof optionsOrWork === 'function' ? optionsOrWork : callback)!;
      const prior = tails.get(name);
      if (options.ifAvailable && prior) return await work(null!);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(name, held);
      try {
        if (prior) await prior;
        return await work({ name });
      } finally {
        if (tails.get(name) === held) tails.delete(name);
        release();
      }
    },
    held: (name: string) => tails.has(name),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
