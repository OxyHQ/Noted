/**
 * The speech models, and getting them onto the device.
 *
 * Transcription happens on the phone, so the weights have to be there. They are
 * NOT bundled: the smallest is 31 MB and the largest 181 MB, which would be paid
 * by every user at install including the ones who never record. They are fetched
 * on demand, once, when the feature is first used.
 */

import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { createLogger } from '@oxyhq/core/logger';

import { execute, executeTransaction } from '@/lib/db/client';
import { isTranscriptionSupported } from '@/lib/capture/support';

const logger = createLogger('NotedSTT');

export type SttModelId = 'tiny' | 'base' | 'small';

export interface SttModel {
  id: SttModelId;
  /** The file whisper.cpp loads. */
  filename: string;
  url: string;
  /** Exact size, so a truncated download is caught before the hash is computed. */
  bytes: number;
  sha256: string;
}

/**
 * Where the weights come from.
 *
 * Hugging Face today. It SHOULD be `cloud.oxy.so`, so that the first run of a
 * feature does not depend on a third party being reachable — that move is
 * infrastructure work, and the base URL is a constant here so it is one edit
 * rather than four.
 */
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/**
 * The three sizes, with the sizes and digests read from the registry rather than
 * copied from a blog post.
 *
 * `base` is the default: on a mid-range phone it keeps up with speech while
 * `small` does not, and it is markedly better than `tiny` at Spanish proper
 * nouns — which is most of what a meeting note is made of. All three are the
 * `q5_1` quantisations; the unquantised files are two to three times the size
 * for a difference nobody reads in a note.
 */
export const STT_MODELS: Record<SttModelId, SttModel> = {
  tiny: {
    id: 'tiny',
    filename: 'ggml-tiny-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-tiny-q5_1.bin`,
    bytes: 32_152_673,
    sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
  },
  base: {
    id: 'base',
    filename: 'ggml-base-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-base-q5_1.bin`,
    bytes: 59_707_625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  },
  small: {
    id: 'small',
    filename: 'ggml-small-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-small-q5_1.bin`,
    bytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
};

export const DEFAULT_STT_MODEL: SttModelId = 'base';

/** Where the weights live. One directory, so clearing them is one call. */
export function modelsDirectory(): Directory {
  return new Directory(Paths.document, 'stt-models');
}

export function modelFile(model: SttModel): File {
  return new File(modelsDirectory(), model.filename);
}

/**
 * Whether a model is ready to load.
 *
 * The size is checked as well as the presence, because an interrupted download
 * leaves a real file at the right path — and whisper.cpp answers a truncated
 * model with a crash rather than an error.
 */
export function isModelPresent(model: SttModel): boolean {
  // Asked before touching the file system, because on web there isn't one:
  // `expo-file-system` throws on construction rather than reporting absence, so
  // even asking the question crashes. A model is weights for whisper.cpp, so
  // where whisper.cpp cannot run there is no such thing as a downloaded one —
  // this is the honest answer, not a guard bolted on to avoid a throw.
  if (!isTranscriptionSupported()) return false;
  const file = modelFile(model);
  return file.exists && file.size === model.bytes;
}

export type ModelState = 'absent' | 'downloading' | 'ready' | 'failed';

interface ModelRow {
  id: string;
  state: string;
  bytes: number;
}

/** What the settings screen reads. */
export async function getModelStates(): Promise<Record<SttModelId, ModelState>> {
  if (!isTranscriptionSupported()) {
    return { tiny: 'absent', base: 'absent', small: 'absent' };
  }
  const rows = await execute<ModelRow & Record<string, never>>(
    'SELECT id, state, bytes FROM stt_models',
  );
  const stored = new Map(rows.map((row) => [row.id, row.state]));

  const states: Record<SttModelId, ModelState> = { tiny: 'absent', base: 'absent', small: 'absent' };
  for (const model of Object.values(STT_MODELS)) {
    // The file on disk is the authority, not the row: a user who cleared the
    // app's storage leaves a row claiming `ready` for a file that is gone.
    if (isModelPresent(model)) {
      states[model.id] = 'ready';
    } else if (stored.get(model.id) === 'downloading') {
      states[model.id] = 'downloading';
    } else if (stored.get(model.id) === 'failed') {
      states[model.id] = 'failed';
    }
  }
  return states;
}

async function recordState(model: SttModel, state: ModelState): Promise<void> {
  const now = new Date().toISOString();
  await executeTransaction([
    {
      sql: `INSERT INTO stt_models (id, path, bytes, sha256, state, downloaded_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET state = excluded.state, downloaded_at = excluded.downloaded_at`,
      params: [
        model.id,
        `stt-models/${model.filename}`,
        model.bytes,
        model.sha256,
        state,
        state === 'ready' ? now : null,
      ],
    },
  ]);
}

/**
 * Fetch a model, unless it is already here.
 *
 * @param onProgress fraction 0–1, for the settings screen. Called on the
 *   download's own schedule, which is not every byte.
 * @throws when the download fails or the file that arrives is not the expected
 *   size. A wrong file is worse than no file: whisper.cpp does not validate what
 *   it loads, so a corrupt model surfaces as a native crash rather than an error.
 */
export async function downloadModel(
  model: SttModel,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (!isTranscriptionSupported()) {
    throw new Error('this platform cannot run a speech model, so there is nothing to download');
  }
  if (isModelPresent(model)) return;

  const directory = modelsDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const destination = modelFile(model);
  // A partial file from an earlier attempt would otherwise be appended to.
  if (destination.exists) destination.delete();

  await recordState(model, 'downloading');
  // `DownloadTask` rather than `File.downloadFileAsync`: only the task reports
  // progress, and 31–181 MB over a phone connection with no feedback reads as a
  // frozen screen.
  const task = new DownloadTask(model.url, destination);
  const subscription = onProgress
    ? task.addListener('progress', ({ bytesWritten, totalBytes }) => {
        // The server may omit Content-Length, in which case `totalBytes` is -1;
        // the size is known here anyway, so the bar never stalls at zero.
        const total = totalBytes > 0 ? totalBytes : model.bytes;
        onProgress(Math.min(1, bytesWritten / total));
      })
    : null;

  try {
    const downloaded = await task.downloadAsync();
    if (!downloaded) throw new Error(`model ${model.id} download produced no file`);

    if (downloaded.size !== model.bytes) {
      downloaded.delete();
      throw new Error(
        `model ${model.id} downloaded ${String(downloaded.size)} bytes, expected ${String(model.bytes)}`,
      );
    }

    await recordState(model, 'ready');
    logger.info('Speech model ready', { model: model.id, bytes: model.bytes });
  } catch (error) {
    await recordState(model, 'failed').catch(() => undefined);
    logger.error('Speech model download failed', { model: model.id, error: String(error) });
    throw error;
  } finally {
    subscription?.remove();
  }
}

/** Remove a model's weights. */
export async function deleteModel(model: SttModel): Promise<void> {
  if (!isTranscriptionSupported()) return;
  const file = modelFile(model);
  if (file.exists) file.delete();
  await recordState(model, 'absent');
}
