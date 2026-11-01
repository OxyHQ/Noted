/**
 * Speech models in the Noted Desktop shell.
 *
 * The webview fetches the weights and Rust (`desktop/src-tauri/src/models.rs`) keeps
 * them in the app's data directory, where the transcriber looks. A model only
 * becomes visible after Rust has checked its size and sha256 against the catalogue,
 * because whisper.cpp crashes on a truncated file instead of reporting it.
 *
 * `invoke` and `fetch` are injected so this runs in tests without a window or a
 * network.
 */

import type { Invoke } from '@/lib/db/desktop-driver';
import { DESKTOP_MODEL_FILES } from '@/lib/stt/desktop-model-files';

export interface DesktopModelInfo {
  id: 'tiny' | 'base' | 'small';
  url: string;
  bytes: number;
  sha256: string;
}

export type DesktopModelState = 'absent' | 'ready';

/** How much is handed to Rust per call: big enough to be cheap, small enough to stay responsive. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

/** Return the inclusive end of a valid resumed range. */
function resumedRangeEnd(header: string | null, offset: number, size: number): number | null {
  if (header === null) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start !== offset ||
    end < start ||
    end >= size ||
    (total !== null && (!Number.isSafeInteger(total) || total !== size))
  )
    return null;
  return end;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

export function createDesktopModels(
  getInvoke: () => Promise<Invoke>,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
) {
  async function stateOf(model: DesktopModelInfo): Promise<DesktopModelState> {
    const invoke = await getInvoke();
    const size = await invoke<number | null>('model_status', {
      name: DESKTOP_MODEL_FILES[model.id],
    });
    return size === model.bytes ? 'ready' : 'absent';
  }

  return {
    stateOf,

    async states(models: readonly DesktopModelInfo[]): Promise<Record<string, DesktopModelState>> {
      const entries = await Promise.all(models.map(async (m) => [m.id, await stateOf(m)] as const));
      return Object.fromEntries(entries);
    },

    /** Fetch, hand to Rust in chunks, and let Rust verify. Resolves only when the model is usable. */
    async download(
      model: DesktopModelInfo,
      onProgress?: (fraction: number) => void,
    ): Promise<void> {
      if ((await stateOf(model)) === 'ready') {
        onProgress?.(1);
        return;
      }
      const invoke = await getInvoke();
      const name = DESKTOP_MODEL_FILES[model.id];

      // A partial file from an interrupted attempt is resumed, not discarded: the
      // models are hundreds of megabytes. Whether the stitched file is right is not
      // trusted to the network, only to Rust's sha256 at the end.
      const have = (await invoke<number>('model_partial', { name })) ?? 0;
      if (have === model.bytes) {
        await invoke('model_commit', { name, bytes: model.bytes, sha256: model.sha256 });
        onProgress?.(1);
        return;
      }
      const resume = have > 0 && have < model.bytes;
      const response = await fetchImpl(
        model.url,
        resume ? { headers: { Range: `bytes=${have}-` } } : undefined,
      );
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(`model download failed: HTTP ${response.status}`);
      }
      // 206 continues where we stopped; a server that ignores Range sends the whole
      // file with 200, and then the partial must be overwritten, not appended to.
      const continuing = resume && response.status === 206;
      const rangeEnd = continuing
        ? resumedRangeEnd(response.headers.get('Content-Range'), have, model.bytes)
        : null;
      if (continuing && rangeEnd === null) {
        // A mismatched response must not be appended to the existing partial.
        void response.body.cancel().catch(() => undefined);
        throw new Error('model resume response has an invalid Content-Range');
      }
      const reader = response.body.getReader();

      let received = continuing ? have : 0;
      let first = !continuing;
      let pending: Uint8Array[] = [];
      let pendingBytes = 0;

      const flush = async () => {
        if (pendingBytes === 0) return;
        const joined = new Uint8Array(pendingBytes);
        let at = 0;
        for (const part of pending) {
          joined.set(part, at);
          at += part.length;
        }
        pending = [];
        pendingBytes = 0;
        await invoke('model_write', { name, chunk: toBase64(joined), reset: first });
        first = false;
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (rangeEnd !== null && value.length > rangeEnd + 1 - received) {
            throw new Error('model resume response exceeds its Content-Range');
          }
          if (value.length > model.bytes - received) {
            throw new Error('model download exceeds its expected size');
          }
          let offset = 0;
          while (offset < value.length) {
            const count = Math.min(CHUNK_BYTES - pendingBytes, value.length - offset);
            // The producer can reuse its buffer before the next read settles.
            pending.push(value.slice(offset, offset + count));
            pendingBytes += count;
            received += count;
            offset += count;
            onProgress?.(Math.min(received / model.bytes, 0.99));
            if (pendingBytes === CHUNK_BYTES) await flush();
          }
        }
        await flush();
        if (rangeEnd !== null && received !== rangeEnd + 1) {
          throw new Error('model resume response ended before its Content-Range');
        }
        if (rangeEnd !== null && received !== model.bytes) {
          throw new Error('model download is incomplete; retry to continue');
        }
        if (first) await invoke('model_write', { name, chunk: '', reset: true });
        await invoke('model_commit', { name, bytes: model.bytes, sha256: model.sha256 });
      } catch (error) {
        // Cancellation can stall in the stream producer; don't hide the download error.
        void reader.cancel().catch(() => undefined);
        // The partial file stays: a dropped connection resumes from it. A bad file
        // never survives, because Rust deletes it when verification fails.
        throw error;
      }
      onProgress?.(1);
    },

    async remove(model: DesktopModelInfo): Promise<void> {
      const invoke = await getInvoke();
      await invoke('model_remove', { name: DESKTOP_MODEL_FILES[model.id] });
    },
  };
}
