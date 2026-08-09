/**
 * Large model files this device has downloaded.
 *
 * Two features need weights on disk — whisper.cpp for speech, and a language
 * model for reading the transcript — and they need exactly the same things of
 * them: fetch with progress, verify what arrived, remember the state, delete.
 * Written once here, so the two cannot drift into behaving differently about a
 * half-finished download.
 *
 * The row is never the authority on presence: a user who cleared the app's
 * storage leaves a row claiming `ready` for a file that is gone.
 */

import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { createLogger } from '@oxyhq/core/logger';

import { execute, executeTransaction } from '@/lib/db/client';
import { hasDownloadableModels } from '@/lib/capture/support';

const logger = createLogger('NotedModels');

/** What separates one feature's weights from another's. */
export type WeightsKind = 'stt' | 'llm';

export interface Weights {
  id: string;
  kind: WeightsKind;
  /** Directory under the document directory, e.g. `stt-models`. */
  directory: string;
  filename: string;
  url: string;
  /** Exact size, so a truncated download is caught. */
  bytes: number;
  sha256: string;
}

export type WeightsState = 'absent' | 'downloading' | 'ready' | 'failed';

/**
 * Whether this device can hold weights at all.
 *
 * Both consumers are native libraries, and on web `expo-file-system` throws on
 * construction rather than reporting absence — so even asking whether a file is
 * present has to be gated, not just the answer. The browser transcribes through
 * a model transformers.js fetches and caches itself, which is why this is a
 * different question from whether transcription works.
 */
function hasWeightsStorage(): boolean {
  return hasDownloadableModels();
}

export function weightsDirectory(weights: Weights): Directory {
  return new Directory(Paths.document, weights.directory);
}

export function weightsFile(weights: Weights): File {
  return new File(weightsDirectory(weights), weights.filename);
}

/**
 * Whether the weights are ready to load.
 *
 * The size is checked as well as the presence, because an interrupted download
 * leaves a real file at the right path — and a truncated model is answered with
 * a native crash rather than an error by both libraries that load one.
 */
export function isPresent(weights: Weights): boolean {
  if (!hasWeightsStorage()) return false;
  const file = weightsFile(weights);
  return file.exists && file.size === weights.bytes;
}

interface StateRow extends Record<string, string | number | null> {
  id: string;
  state: string;
}

/** The stored state of every file of one kind, corrected by what is on disk. */
export async function statesOf(
  registry: readonly Weights[],
): Promise<Record<string, WeightsState>> {
  const states: Record<string, WeightsState> = {};
  for (const weights of registry) states[weights.id] = 'absent';
  if (!hasWeightsStorage()) return states;

  const rows = await execute<StateRow>('SELECT id, state FROM model_files WHERE kind = ?', [
    registry[0]?.kind ?? 'stt',
  ]);
  const stored = new Map(rows.map((row) => [row.id, row.state]));

  for (const weights of registry) {
    if (isPresent(weights)) {
      states[weights.id] = 'ready';
      continue;
    }
    const state = stored.get(weights.id);
    if (state === 'downloading' || state === 'failed') states[weights.id] = state;
  }
  return states;
}

async function recordState(weights: Weights, state: WeightsState): Promise<void> {
  const now = new Date().toISOString();
  await executeTransaction([
    {
      sql: `INSERT INTO model_files (id, kind, path, bytes, sha256, state, downloaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET state = excluded.state, downloaded_at = excluded.downloaded_at`,
      params: [
        weights.id,
        weights.kind,
        `${weights.directory}/${weights.filename}`,
        weights.bytes,
        weights.sha256,
        state,
        state === 'ready' ? now : null,
      ],
    },
  ]);
}

/**
 * Fetch the weights, unless they are already here.
 *
 * @param onProgress fraction 0–1. Called on the download's own schedule, which
 *   is not every byte.
 * @throws when the download fails or what arrives is not the expected size. A
 *   wrong file is worse than no file: neither library validates what it loads,
 *   so a corrupt model surfaces as a native crash rather than an error.
 */
export async function download(
  weights: Weights,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (!hasWeightsStorage()) {
    throw new Error('this platform cannot run a model, so there is nothing to download');
  }
  if (isPresent(weights)) return;

  weightsDirectory(weights).create({ intermediates: true, idempotent: true });
  const destination = weightsFile(weights);
  // A partial file from an earlier attempt would otherwise be appended to.
  if (destination.exists) destination.delete();

  await recordState(weights, 'downloading');
  // `DownloadTask` rather than `File.downloadFileAsync`: only the task reports
  // progress, and hundreds of megabytes over a phone connection with no
  // feedback reads as a frozen screen.
  const task = new DownloadTask(weights.url, destination);
  const subscription = onProgress
    ? task.addListener('progress', ({ bytesWritten, totalBytes }) => {
        // The server may omit Content-Length, in which case `totalBytes` is -1;
        // the size is known here anyway, so the bar never stalls at zero.
        const total = totalBytes > 0 ? totalBytes : weights.bytes;
        onProgress(Math.min(1, bytesWritten / total));
      })
    : null;

  try {
    const downloaded = await task.downloadAsync();
    if (!downloaded) throw new Error(`${weights.id} download produced no file`);

    if (downloaded.size !== weights.bytes) {
      downloaded.delete();
      throw new Error(
        `${weights.id} downloaded ${String(downloaded.size)} bytes, expected ${String(weights.bytes)}`,
      );
    }

    await recordState(weights, 'ready');
    logger.info('Model ready', { model: weights.id, bytes: weights.bytes });
  } catch (error) {
    await recordState(weights, 'failed').catch(() => undefined);
    logger.error('Model download failed', { model: weights.id, error: String(error) });
    throw error;
  } finally {
    subscription?.remove();
  }
}

/** Remove the weights from disk. */
export async function remove(weights: Weights): Promise<void> {
  if (!hasWeightsStorage()) return;
  const file = weightsFile(weights);
  if (file.exists) file.delete();
  await recordState(weights, 'absent');
}
