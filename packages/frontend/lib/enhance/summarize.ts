/**
 * Reading a meeting with a language model — everything except running it.
 *
 * The work of turning a transcript into a note is the same wherever it happens:
 * cut the transcript into windows the model can hold, ask each one, refuse
 * anything unusable that comes back, and combine the answers. Only the last mile
 * differs — llama.cpp through `llama.rn` on a phone, ONNX through
 * transformers.js in a browser — so that is the only thing the platforms
 * provide.
 *
 * Everything here is therefore shared, and testable without a model: a fake
 * `generate` exercises the same code the real one runs.
 */

import { createLogger } from '@oxyhq/core/logger';

import type { EnhanceRequest, Enhancement } from '@/lib/enhance/contract';
import { parseEnhancement } from '@/lib/enhance/parse';
import {
  buildPrompt,
  mergeEnhancements,
  splitForContext,
  type TranscriptLine,
} from '@/lib/enhance/prompt';

const logger = createLogger('NotedEnhance');

/**
 * Run the model on one prompt and hand back what it said, verbatim.
 *
 * The only thing a platform has to provide. Returning raw text rather than a
 * parsed object is deliberate: parsing is where a model's sloppiness meets the
 * user's note, and that judgement belongs in one place rather than in each
 * backend.
 */
export type Generate = (prompt: string) => Promise<string>;

/**
 * Turn a transcript into a note.
 *
 * @returns null when nothing usable came back — a complete answer, not a
 *   failure: the deterministic note is already written, so "no improvement"
 *   costs the user nothing.
 */
export async function summarize(
  request: EnhanceRequest,
  generate: Generate,
): Promise<Enhancement | null> {
  if (request.transcript.length === 0) return null;

  const windows = splitForContext(request.transcript as readonly TranscriptLine[]);
  const parts: Enhancement[] = [];

  for (const window of windows) {
    const prompt = buildPrompt(window, {
      language: request.language,
      existingBody: request.existing?.body,
      isPartial: windows.length > 1,
    });

    const reply = await generate(prompt);
    const parsed = parseEnhancement(reply);
    if (parsed) {
      parts.push(parsed);
      continue;
    }
    // A window the model made nothing of is skipped rather than fatal: the rest
    // of the meeting still has something to say, and one bad reply should not
    // cost the user the whole note.
    logger.warn('The model returned nothing usable for one window');
  }

  return mergeEnhancements(parts);
}
