/**
 * Reading the meeting with a language model, on the phone.
 *
 * llama.cpp through `llama.rn`, so the same code runs on iOS and Android and
 * nothing leaves the device. A meeting transcript is about as private as a
 * document gets, and the cheapest way to keep it private is for it never to be
 * uploaded.
 *
 * The model is asked for JSON through `response_format: json_schema`, which
 * constrains generation rather than requesting politely — a 0.5B model asked
 * nicely for JSON produces prose surprisingly often. `parse.ts` still refuses
 * anything malformed, because a constrained grammar guarantees the shape and
 * says nothing about whether the contents are usable.
 */

import { initLlama, releaseAllLlama, type LlamaContext } from 'llama.rn';
import { createLogger } from '@oxyhq/core/logger';

import type { EnhanceRequest, Enhancement, OnDeviceSummarizer } from '@/lib/enhance/contract';
import { isLlmModelPresent, llmModelPath } from '@/lib/enhance/models';
import { parseEnhancement } from '@/lib/enhance/parse';
import {
  buildPrompt,
  mergeEnhancements,
  splitForContext,
  type TranscriptLine,
} from '@/lib/enhance/prompt';

const logger = createLogger('NotedEnhance');

/**
 * Context window, in tokens.
 *
 * Has to hold one window of transcript plus the instructions plus the reply.
 * `splitForContext` budgets the transcript in characters against this.
 */
const CONTEXT_TOKENS = 4096;

/** Threads left to the model, keeping cores free for whatever else is running. */
const THREADS = 4;

/** Enough for the JSON reply; past this the model is repeating itself. */
const MAX_REPLY_TOKENS = 700;

/**
 * The shape the model is constrained to emit.
 *
 * Every field is required so the model cannot answer with a subset it finds
 * easier — an empty array is a meaningful answer here and a missing key is not.
 */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'notes', 'actions', 'openQuestions'],
} as const;

/**
 * One loaded model at a time.
 *
 * Loading is seconds and hundreds of megabytes of RAM. Kept between meetings,
 * and released when the app is done with it.
 */
let context: LlamaContext | null = null;

async function getContext(): Promise<LlamaContext> {
  if (context) return context;

  const path = llmModelPath();
  if (!path) throw new Error('the language model is not downloaded');

  context = await initLlama({
    model: path,
    n_ctx: CONTEXT_TOKENS,
    n_threads: THREADS,
    // The GPU is whisper's while a recording is running, and enhancement runs
    // after it stops — but a user can stop one meeting and start another, so
    // the model stays on the CPU rather than contending for the same device.
    n_gpu_layers: 0,
  });
  logger.info('Language model loaded');
  return context;
}

export function getSummarizer(): OnDeviceSummarizer {
  return {
    availability: () => Promise.resolve(isLlmModelPresent() ? 'ready' : 'downloadable'),

    async enhance(request: EnhanceRequest): Promise<Enhancement | null> {
      if (request.transcript.length === 0) return null;
      if (!isLlmModelPresent()) return null;

      const llama = await getContext();
      const windows = splitForContext(request.transcript as readonly TranscriptLine[]);
      const parts: Enhancement[] = [];

      for (const window of windows) {
        const prompt = buildPrompt(window, {
          language: request.language,
          existingBody: request.existing?.body,
          isPartial: windows.length > 1,
        });

        const result = await llama.completion({
          messages: [{ role: 'user', content: prompt }],
          n_predict: MAX_REPLY_TOKENS,
          // Low, not zero: this is extraction, not invention, and a model left
          // free to be creative here invents action items.
          temperature: 0.2,
          response_format: { type: 'json_schema', json_schema: { strict: true, schema: REPLY_SCHEMA } },
        });

        const parsed = parseEnhancement(result.text);
        // A window the model made nothing of is skipped, not fatal: the rest of
        // the meeting still has something to say.
        if (parsed) parts.push(parsed);
      }

      return mergeEnhancements(parts);
    },
  };
}

/** Free the loaded model (low memory, sign-out). */
export async function releaseSummarizer(): Promise<void> {
  if (!context) return;
  context = null;
  await releaseAllLlama();
}
