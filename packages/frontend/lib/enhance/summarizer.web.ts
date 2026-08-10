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
  EnhanceAttempt,
  EnhanceRequest,
  LocalModelCapability,
  OnDeviceSummarizer,
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

/**
 * How much room the reply gets, computed rather than fixed.
 *
 * It was a flat 700, chosen when a reply was four arrays of short strings. The
 * canonical document is a different size — a title, people, thematic sections
 * each holding paragraph blocks with source arrays, actions, open questions —
 * and 700 tokens ends a correct answer somewhere inside it. The parser then saw
 * an object that never closed, returned nothing, and the user was told their
 * device was incapable.
 *
 * So the budget scales with how much there is to say, and the ceiling is a
 * safety limit rather than the working value.
 */
const REPLY_TOKENS_BASE = 700;
const REPLY_TOKENS_PER_LINE = 60;
const REPLY_TOKENS_CEILING = 3_000;

function replyBudget(lineCount: number): number {
  return Math.min(REPLY_TOKENS_CEILING, REPLY_TOKENS_BASE + lineCount * REPLY_TOKENS_PER_LINE);
}

/**
 * The pipeline's own type, rather than one written by hand here.
 *
 * A hand-written signature is a second, silently drifting copy of someone
 * else's contract — and it type-checked while returning a shape the library
 * does not produce.
 */
type Generator = Awaited<ReturnType<typeof import('@huggingface/transformers').pipeline<'text-generation'>>>;

let generatorPromise: Promise<Generator> | null = null;

/**
 * The capability answer for this runtime lifecycle.
 *
 * Cached because it used to be asked three times per enhancement — in
 * `availability()`, again at the start of `enhance()`, and again while building
 * the pipeline — so the adapter that chose the dtype was not necessarily the
 * one inference ran on, and two answers could disagree within a single attempt.
 *
 * Cleared deliberately by `releaseSummarizer` and after a runtime failure, so a
 * transient refusal is retryable rather than sticky for the life of the tab.
 */
let capabilityPromise: Promise<LocalModelCapability> | null = null;

interface GpuDeviceLike {
  features?: { has(feature: string): boolean };
}

interface GpuAdapterLike {
  features?: { has(feature: string): boolean };
  requestDevice?: () => Promise<GpuDeviceLike | null>;
}

interface GpuLike {
  requestAdapter: () => Promise<GpuAdapterLike | null>;
}

/**
 * Ask the browser what it can actually do, all the way to a device.
 *
 * An adapter is not the thing that runs shaders. A machine can advertise one
 * and refuse `requestDevice()` — a blocklisted driver, an exhausted context, a
 * headless session — and the old probe called that "supported", loaded 483 MB,
 * and failed afterwards. So the probe goes one step further than the question it
 * is answering.
 */
async function probeCapability(): Promise<LocalModelCapability> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    // `navigator.gpu` is withheld from an insecure page, so without this check
    // the reason reads as "your browser has no WebGPU" when the fix is the URL.
    return { kind: 'unavailable', reason: 'insecure_context' };
  }

  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) return { kind: 'unavailable', reason: 'navigator_gpu_missing' };

  let adapter: GpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) return { kind: 'unavailable', reason: 'adapter_unavailable' };

  let device: GpuDeviceLike | null = null;
  try {
    device = (await adapter.requestDevice?.()) ?? null;
  } catch {
    device = null;
  }
  if (!device) return { kind: 'unavailable', reason: 'device_request_failed' };

  // Asked of the DEVICE where it can answer, since that is what compiles the
  // shaders; the adapter is the fallback for a runtime that hands back a device
  // without a feature set. Getting this wrong produced a 483 MB download
  // followed by `Program Gather requires f16 but the device does not support it`.
  const shaderF16 =
    device.features?.has('shader-f16') === true || adapter.features?.has('shader-f16') === true;

  return { kind: 'ready', backend: 'webgpu', dtype: shaderF16 ? 'q4f16' : 'q4', shaderF16 };
}

function capability(): Promise<LocalModelCapability> {
  capabilityPromise ??= probeCapability();
  return capabilityPromise;
}

async function getGenerator(dtype: 'q4f16' | 'q4'): Promise<Generator> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      logger.info('Loading the browser language model', { model: MODEL_ID, dtype });
      return pipeline('text-generation', MODEL_ID, { device: 'webgpu', dtype });
    })().catch((error: unknown) => {
      // Cleared so a later attempt can retry: the usual cause is a network
      // failure fetching the weights, which is not permanent. The capability
      // answer goes with it, because a runtime that would not initialise is a
      // capability fact and the next attempt must re-establish it.
      generatorPromise = null;
      capabilityPromise = null;
      throw error;
    });
  }
  return generatorPromise;
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

/**
 * Whether generation stopped because the model finished or because it ran out
 * of room.
 *
 * Counted with the pipeline's own tokenizer rather than guessed from the last
 * character: a reply can end on `}` and still be truncated, and one can end
 * mid-word and be a complete refusal. The count is the real signal — a reply
 * whose token length reaches the budget did not choose to stop.
 */
function hitTokenCap(generator: Generator, text: string, budget: number): boolean {
  try {
    const tokenizer = (generator as unknown as { tokenizer?: { encode: (input: string) => unknown[] } })
      .tokenizer;
    const tokens = tokenizer?.encode(text);
    return Array.isArray(tokens) && tokens.length >= budget;
  } catch {
    // A tokenizer that will not answer is not a reason to fail the attempt; the
    // parser's own brace check still identifies an object that never closed.
    return false;
  }
}

export function getSummarizer(): OnDeviceSummarizer {
  return {
    capability,

    async enhance(request: EnhanceRequest): Promise<EnhanceAttempt> {
      const capable = await capability();
      if (capable.kind !== 'ready') return { ok: false, kind: 'unavailable', capability: capable };

      // Hundreds of megabytes the first time, and cached afterwards — so this is
      // reported as a download rather than as work on the notes. A silent
      // 483 MB fetch under "Organizing notes…" is the thing that makes a stop
      // button look broken.
      request.onProgress?.({ stage: 'downloading', ratio: null });
      const generate = await getGenerator(capable.dtype);

      let truncated = false;
      const result = await summarize(request, async (prompt, lineCount) => {
        const budget = replyBudget(lineCount);
        const output = await generate([{ role: 'user', content: prompt }], {
          max_new_tokens: budget,
          // Low, not zero: this is extraction, not invention, and a model left
          // free to be creative here invents action items.
          temperature: 0.2,
          do_sample: true,
          return_full_text: false,
        });
        const text = textOf(output);
        if (hitTokenCap(generate, text, budget)) truncated = true;
        return text;
      });

      if (result.ok) return { ok: true, value: result.value };
      // The runtime knows something the parser cannot: a reply that reached the
      // ceiling was cut off even if its braces happened to balance.
      return { ok: false, kind: 'invalid-output', reason: truncated ? 'truncated' : result.reason };
    },
  };
}

/** Free the loaded model (low memory, sign-out). */
export function releaseSummarizer(): Promise<void> {
  generatorPromise = null;
  capabilityPromise = null;
  return Promise.resolve();
}
