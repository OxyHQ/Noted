/**
 * The language model that reads the transcript.
 *
 * One model, and it is opt-in. 469 MB is a real cost on a phone plan, so nobody
 * pays it by accident: the rule-based note is written either way, and this only
 * exists for someone who wants the notes actually read rather than
 * pattern-matched.
 *
 * ## Why this model
 *
 * Qwen2.5-0.5B-Instruct, `q4_k_m`. The job is narrow — read a few thousand words
 * and answer with JSON — which is about the smallest useful ask of a language
 * model, and it is the size that leaves enough memory for whisper to keep
 * running alongside it on a mid-range phone. A 1B model summarises better and
 * doubles both the download and the working set.
 *
 * The size and digest were read from the Hugging Face registry, not copied from
 * a model card: `bytes` is what `Content-Length` reports and `sha256` is the
 * LFS digest, so a truncated or substituted download is caught before whisper's
 * neighbour tries to load it and crashes the app natively.
 */

import { download, isPresent, remove, statesOf, weightsFile, type Weights } from '@/lib/models/weights';
import type { WeightsState } from '@/lib/models/weights';

export const LLM_MODEL: Weights = {
  id: 'qwen2.5-0.5b-instruct-q4_k_m',
  kind: 'llm',
  directory: 'llm-models',
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  bytes: 491_400_032,
  sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
};

/** Absolute path for the runtime to load, or null when it is not downloaded. */
export function llmModelPath(): string | null {
  return isPresent(LLM_MODEL) ? weightsFile(LLM_MODEL).uri : null;
}

export function isLlmModelPresent(): boolean {
  return isPresent(LLM_MODEL);
}

export async function llmModelState(): Promise<WeightsState> {
  const states = await statesOf([LLM_MODEL]);
  return states[LLM_MODEL.id] ?? 'absent';
}

export function downloadLlmModel(onProgress?: (fraction: number) => void): Promise<void> {
  return download(LLM_MODEL, onProgress);
}

export function deleteLlmModel(): Promise<void> {
  return remove(LLM_MODEL);
}
