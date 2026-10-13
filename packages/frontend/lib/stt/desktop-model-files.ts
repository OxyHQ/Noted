import type { SttModelId } from '@/lib/stt/models';

/**
 * The model file each model id is stored as.
 *
 * A copy of `STT_MODELS[id].filename`, kept here so the web build does not import
 * the weights machinery (and expo-file-system) just to name a file; a test pins the
 * two together.
 */
export const DESKTOP_MODEL_FILES: Record<SttModelId, string> = {
  tiny: 'ggml-tiny-q5_1.bin',
  base: 'ggml-base-q5_1.bin',
  small: 'ggml-small-q5_1.bin',
};
