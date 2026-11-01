import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChunkBackend } from '@/lib/audio/backend.web';

afterEach(() => vi.unstubAllGlobals());

describe('audio deletion failures', () => {
  it('treats a missing OPFS directory as already deleted but propagates other errors', async () => {
    const removeEntry = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('missing', 'NotFoundError'))
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => ({ getDirectoryHandle: async () => ({ removeEntry }) }),
      },
    });
    const backend = createChunkBackend();
    await expect(backend.remove('capture')).resolves.toBeUndefined();
    await expect(backend.remove('capture')).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('does not report IndexedDB deletion complete when its transaction aborts after request success', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('IDBKeyRange', { bound: () => ({}) });
    const database = {
      transaction: () => {
        const tx: {
          error: Error;
          onabort?: () => void;
          oncomplete?: () => void;
          objectStore: () => unknown;
        } = {
          error: new Error('transaction aborted'),
          objectStore: () => ({
            delete: () => {
              const request: { result?: unknown; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                request.onsuccess?.();
                queueMicrotask(() => tx.onabort?.());
              });
              return request;
            },
          }),
        };
        return tx;
      },
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        queueMicrotask(() => {
          request.result = database;
          request.onsuccess?.();
        });
        return request;
      },
    });
    await expect(createChunkBackend().remove('capture')).rejects.toThrow('transaction aborted');
  });

  it('deletes both IndexedDB stores in one transaction and waits for commit', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('IDBKeyRange', { bound: () => ({}) });
    const deletes: string[] = [];
    const tx: { oncomplete?: () => void; objectStore: (name: string) => unknown } = {
      objectStore: (name) => ({
        delete: () => {
          deletes.push(name);
          return {};
        },
      }),
    };
    const transaction = vi.fn(() => tx);
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        queueMicrotask(() => {
          request.result = { transaction };
          request.onsuccess?.();
        });
        return request;
      },
    });
    let settled = false;
    const deletion = createChunkBackend()
      .remove('capture')
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(deletes).toEqual(['chunks', 'manifests']));
    expect(transaction).toHaveBeenCalledWith(['chunks', 'manifests'], 'readwrite');
    expect(settled).toBe(false);
    tx.oncomplete?.();
    await expect(deletion).resolves.toBeUndefined();
  });

  it('aborts after a synchronous second delete failure and waits for the abort', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('IDBKeyRange', { bound: () => ({}) });
    const setupError = new Error('manifest request failed');
    const tx: {
      onabort?: () => void;
      abort: ReturnType<typeof vi.fn>;
      objectStore: (name: string) => unknown;
    } = {
      abort: vi.fn(),
      objectStore: (name) => ({
        delete: () => {
          if (name === 'manifests') throw setupError;
          return {};
        },
      }),
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        queueMicrotask(() => {
          request.result = { transaction: () => tx };
          request.onsuccess?.();
        });
        return request;
      },
    });
    let settled = false;
    const outcome = createChunkBackend()
      .remove('capture')
      .then(
        () => {
          settled = true;
          return null;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
    await vi.waitFor(() => expect(tx.abort).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    tx.onabort?.();
    await expect(outcome).resolves.toBe(setupError);
  });

  it('waits for an asynchronous request error to abort the transaction', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('IDBKeyRange', { bound: () => ({}) });
    const requestError = new Error('chunk delete failed');
    const chunk: { error: Error; onerror?: () => void } = { error: requestError };
    const tx: {
      error: Error | null;
      onerror?: () => void;
      onabort?: () => void;
      objectStore: (name: string) => unknown;
    } = {
      error: null,
      objectStore: (name) => ({ delete: () => (name === 'chunks' ? chunk : {}) }),
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        queueMicrotask(() => {
          request.result = { transaction: () => tx };
          request.onsuccess?.();
        });
        return request;
      },
    });
    let settled = false;
    const outcome = createChunkBackend()
      .remove('capture')
      .then(
        () => {
          settled = true;
          return null;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
    await vi.waitFor(() => expect(chunk.onerror).toBeDefined());
    chunk.onerror?.();
    tx.onerror?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    tx.onabort?.();
    await expect(outcome).resolves.toBe(requestError);
  });

  it('reports both errors if the transaction cannot be aborted after setup fails', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('IDBKeyRange', { bound: () => ({}) });
    const setupError = new Error('manifest request failed');
    const abortError = new Error('abort failed');
    const tx = {
      abort: () => {
        throw abortError;
      },
      objectStore: (name: string) => ({
        delete: () => {
          if (name === 'manifests') throw setupError;
          return {};
        },
      }),
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        queueMicrotask(() => {
          request.result = { transaction: () => tx };
          request.onsuccess?.();
        });
        return request;
      },
    });
    const error = await createChunkBackend()
      .remove('capture')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Could not abort audio deletion');
    expect((error as Error & { errors: unknown[] }).errors).toEqual([setupError, abortError]);
  });

  it('waits for an IndexedDB write transaction to commit after its request succeeds', async () => {
    vi.stubGlobal('navigator', {});
    let transaction: { oncomplete?: () => void; objectStore: () => unknown } | undefined;
    let requestSucceeded = false;
    const database = {
      transaction: () => {
        transaction = {
          objectStore: () => ({
            put: () => {
              const request: { result?: unknown; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                requestSucceeded = true;
                request.onsuccess?.();
              });
              return request;
            },
          }),
        };
        return transaction;
      },
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        queueMicrotask(() => {
          request.result = database;
          request.onsuccess?.();
        });
        return request;
      },
    });
    let settled = false;
    const write = createChunkBackend()
      .put('capture', 0, new Uint8Array([1]))
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(requestSucceeded).toBe(true));
    expect(settled).toBe(false);
    transaction?.oncomplete?.();
    await expect(write).resolves.toBeUndefined();
  });
});
