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

import type {
  EnhanceRequest,
  OnDeviceSummarizer,
  ResolvedEnhancement,
} from '@/lib/enhance/contract';
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

/**
 * Which quantisation to load, decided by what the GPU can actually run.
 *
 * `q4f16` is half the download and half the memory, and it needs the adapter to
 * support half-precision shaders. Plenty do not — and the failure is not a
 * graceful fallback, it is the model loading, the recording finishing, and
 * generation dying mid-sentence with:
 *
 *     Program Gather requires f16 but the device does not support it.
 *
 * by which point the user has recorded a meeting and waited for a 483 MB
 * download. `shader-f16` is a feature the adapter advertises, so this is a
 * question that can be asked before anything is fetched rather than discovered
 * afterwards.
 */
const DTYPE_WITH_F16 = 'q4f16' as const;
const DTYPE_WITHOUT_F16 = 'q4' as const;

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

/** What the adapter advertises, or null when there is no adapter at all. */
interface AdapterLike {
  features?: { has(feature: string): boolean };
}

async function requestAdapter(): Promise<AdapterLike | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<AdapterLike | null> } })
    .gpu;
  if (!gpu) return null;
  try {
    return await gpu.requestAdapter();
  } catch {
    // An adapter that is advertised and then refused — a blocklisted driver, a
    // headless context — is no adapter.
    return null;
  }
}

/**
 * The quantisation this device can run.
 *
 * Asked of the adapter rather than assumed, because assuming is what produced a
 * 483 MB download followed by a shader compilation failure.
 */
function dtypeFor(adapter: AdapterLike): typeof DTYPE_WITH_F16 | typeof DTYPE_WITHOUT_F16 {
  return adapter.features?.has('shader-f16') === true ? DTYPE_WITH_F16 : DTYPE_WITHOUT_F16;
}

async function hasWebGpu(): Promise<boolean> {
  return (await requestAdapter()) !== null;
}

async function getGenerator(): Promise<Generator> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const adapter = await requestAdapter();
      if (!adapter) throw new Error('this browser has no WebGPU adapter');
      const dtype = dtypeFor(adapter);
      logger.info('Loading the browser language model', { model: MODEL_ID, dtype });
      return pipeline('text-generation', MODEL_ID, { device: 'webgpu', dtype });
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

    async enhance(request: EnhanceRequest): Promise<ResolvedEnhancement | null> {
      if (!(await hasWebGpu())) return null;
      // Hundreds of megabytes the first time, and cached afterwards — so this is
      // reported as a download rather than as work on the notes. A silent
      // 483 MB fetch under "Organizing notes…" is the thing that makes a stop
      // button look broken.
      request.onProgress?.({ stage: 'downloading', ratio: null });
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
