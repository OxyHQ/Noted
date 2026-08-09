/**
 * The speech models this app can run.
 *
 * Transcription happens on the phone, so the weights have to be there. They are
 * NOT bundled: the smallest is 31 MB and the largest 181 MB, which would be paid
 * by every user at install including the ones who never record. They are fetched
 * on demand, once, when the feature is first used.
 *
 * The mechanics of getting weights onto a device — fetching with progress,
 * verifying what arrived, remembering the state — live in `lib/models/weights`
 * and are shared with the language model. What is specific to speech is here:
 * which models exist, what they cost, and which one is worth defaulting to.
 */

import type { File } from 'expo-file-system';

import {
  download,
  isPresent,
  remove,
  statesOf,
  weightsFile,
  type Weights,
  type WeightsState,
} from '@/lib/models/weights';

export type SttModelId = 'tiny' | 'base' | 'small';

export type SttModel = Weights & { id: SttModelId };

/** Named for what callers care about; the mechanism is `lib/models/weights`. */
export type ModelState = WeightsState;

/**
 * Where the weights come from.
 *
 * Hugging Face today. It SHOULD be `cloud.oxy.so`, so that the first run of a
 * feature does not depend on a third party being reachable — that move is
 * infrastructure work, and the base URL is a constant here so it is one edit
 * rather than four.
 */
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** One directory, so clearing them is one call. */
const DIRECTORY = 'stt-models';

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
    kind: 'stt',
    directory: DIRECTORY,
    filename: 'ggml-tiny-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-tiny-q5_1.bin`,
    bytes: 32_152_673,
    sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
  },
  base: {
    id: 'base',
    kind: 'stt',
    directory: DIRECTORY,
    filename: 'ggml-base-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-base-q5_1.bin`,
    bytes: 59_707_625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  },
  small: {
    id: 'small',
    kind: 'stt',
    directory: DIRECTORY,
    filename: 'ggml-small-q5_1.bin',
    url: `${MODEL_BASE_URL}/ggml-small-q5_1.bin`,
    bytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
};

export const DEFAULT_STT_MODEL: SttModelId = 'base';

export function modelFile(model: SttModel): File {
  return weightsFile(model);
}

export function isModelPresent(model: SttModel): boolean {
  return isPresent(model);
}

/** What the settings screen reads. */
export async function getModelStates(): Promise<Record<SttModelId, ModelState>> {
  const states = await statesOf(Object.values(STT_MODELS));
  return {
    tiny: states.tiny ?? 'absent',
    base: states.base ?? 'absent',
    small: states.small ?? 'absent',
  };
}

export function downloadModel(
  model: SttModel,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return download(model, onProgress);
}

export function deleteModel(model: SttModel): Promise<void> {
  return remove(model);
}
