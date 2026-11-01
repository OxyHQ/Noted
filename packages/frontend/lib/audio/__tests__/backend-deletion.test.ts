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
