/**
 * Reading the meeting with a language model, in a browser.
 *
 * Same job as the phone and, deliberately, the same code: windowing, the
 * prompt, refusing an unusable reply and combining the answers all live in
 * `summarize`. Only running the model differs — ONNX through transformers.js
 * here, llama.cpp through `llama.rn` there — so only that is written twice.
 *
 * Nothing leaves the machine. The weights are fetched once and cached by the
 * browser, which is also why there is nothing to download in settings: unlike
 * the phone, the app never manages a file.
 *
 * ## Why this requires WebGPU
 *
 * A 0.5B model generating a few hundred tokens is seconds on a GPU and minutes
 * on WASM — long enough that a person would stop the recording, close the tab
 * and conclude the feature is broken. So without an adapter this reports
 * `unsupported` and the rule-based note stands, which is a worse note honestly
 * delivered rather than a better one that never arrives.
 */

import { createLogger } from '@oxyhq/core/logger';

import type { EnhanceRequest, Enhancement, OnDeviceSummarizer } from '@/lib/enhance/contract';
import { summarize } from '@/lib/enhance/summarize';

const logger = createLogger('NotedEnhance');

/**
 * Qwen2.5-0.5B-Instruct, the ONNX build of the model the phone runs.
 *
 * The same model on both platforms so a note does not change character with the
 * device that took it. `q4f16` is 483 MB against 786 MB for `q4`, and halves
 * again in memory on the GPU.
 */
const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

const DTYPE = 'q4f16';

/** Enough for the JSON reply; past this the model is repeating itself. */
const MAX_REPLY_TOKENS = 700;

/**
 * The pipeline's own type, rather than one written by hand here.
 *
 * A hand-written signature is a second, silently drifting copy of someone
 * else's contract — and it type-checked while returning a shape the library
 * does not produce.
 */
type Generator = Awaited<ReturnType<typeof import('@huggingface/transformers').pipeline<'text-generation'>>>;

let generatorPromise: Promise<Generator> | null = null;

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function getGenerator(): Promise<Generator> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      logger.info('Loading the browser language model', { model: MODEL_ID, dtype: DTYPE });
      return pipeline('text-generation', MODEL_ID, { device: 'webgpu', dtype: DTYPE });
    })().catch((error: unknown) => {
      // Cleared so a later attempt can retry: the usual cause is a network
      // failure fetching the weights, which is not permanent.
      generatorPromise = null;
      throw error;
    });
  }
  return generatorPromise as Promise<Generator>;
}

/**
 * The reply text, whichever shape the pipeline returns it in.
 *
 * Four of them, per the library's own union: one result or a list, and plain
 * text or a chat. Narrowed rather than cast, because the shape depends on
 * options that are easy to change later and a cast would keep compiling while
 * silently reading nothing.
 */
function textOf(output: Awaited<ReturnType<Generator>>): string {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || !('generated_text' in first)) return '';

  const generated = first.generated_text;
  if (typeof generated === 'string') return generated;

  // A chat pipeline hands back the whole conversation; the answer is the last
  // turn, not the first.
  const last = generated.at(-1);
  return typeof last?.content === 'string' ? last.content : '';
}

export function getSummarizer(): OnDeviceSummarizer {
  return {
    availability: async () => ((await hasWebGpu()) ? 'ready' : 'unsupported'),

    async enhance(request: EnhanceRequest): Promise<Enhancement | null> {
      if (!(await hasWebGpu())) return null;
      const generate = await getGenerator();

      return summarize(request, async (prompt) => {
        const output = await generate([{ role: 'user', content: prompt }], {
          max_new_tokens: MAX_REPLY_TOKENS,
          // Low, not zero: this is extraction, not invention, and a model left
          // free to be creative here invents action items.
          temperature: 0.2,
          do_sample: true,
          return_full_text: false,
        });
        return textOf(output);
      });
    },
  };
}

/** Free the loaded model (low memory, sign-out). */
export function releaseSummarizer(): Promise<void> {
  generatorPromise = null;
  return Promise.resolve();
}
