/**
 * Reading a recording with a language model — everything except running it.
 *
 * The work of turning a transcript into a note is the same wherever it happens:
 * cut the transcript into windows the model can hold, ask each one, refuse
 * anything unusable that comes back, resolve its citations, and combine the
 * answers. Only the last mile differs — llama.cpp through `llama.rn` on a phone,
 * ONNX through transformers.js in a browser — so that is the only thing the
 * platforms provide.
 *
 * Everything here is therefore shared, and testable without a model: a fake
 * `generate` exercises the same code the real one runs.
 */

import { createLogger } from '@oxyhq/core/logger';

import type {
  EnhanceLine,
  EnhanceRequest,
  EnhancementItem,
  ResolvedEnhancement,
  ResolvedItem,
} from '@/lib/enhance/contract';
import { parseEnhancement } from '@/lib/enhance/parse';
import { buildPrompt, splitForContext } from '@/lib/enhance/prompt';

const logger = createLogger('NotedEnhance');

// Re-exported so a caller that only ever touches this module does not have to
// know the shapes are declared in the contract beside it.
export type { ResolvedEnhancement, ResolvedItem };

/**
 * Run the model on one prompt and hand back what it said, verbatim.
 *
 * The only thing a platform has to provide. Returning raw text rather than a
 * parsed object is deliberate: parsing is where a model's sloppiness meets the
 * user's note, and that judgement belongs in one place rather than in each
 * backend.
 */
export type Generate = (prompt: string) => Promise<string>;

function resolveItem(item: EnhancementItem, window: readonly EnhanceLine[]): ResolvedItem {
  const lines = item.sources.map((source) => window[source - 1]).filter(Boolean);
  return {
    text: item.text,
    segmentIds: [...new Set(lines.flatMap((line) => line.segmentIds))],
    atMs: lines.length > 0 ? Math.min(...lines.map((line) => line.atMs)) : null,
    ...(item.derived ? { derived: item.derived } : {}),
  };
}

/**
 * Combine the answers from several windows into one note.
 *
 * Order is preserved because a recording has one, and repeats are dropped because
 * the same decision restated in two windows is one decision — with the citations
 * of both kept, since it really was said twice. The title comes from the first
 * window that produced one: the beginning of a recording is where people say what
 * it is about.
 */
function merge(parts: readonly ResolvedEnhancement[]): ResolvedEnhancement | null {
  const merged: ResolvedEnhancement = {
    title: '',
    notes: [],
    actions: [],
    openQuestions: [],
    listAdditions: [],
  };

  for (const part of parts) {
    if (merged.title === '' && part.title !== '') merged.title = part.title;
    for (const field of ['notes', 'actions', 'openQuestions', 'listAdditions'] as const) {
      for (const item of part[field]) {
        const existing = merged[field].find(
          (candidate) => candidate.text.toLowerCase() === item.text.toLowerCase(),
        );
        if (existing) {
          existing.segmentIds = [...new Set([...existing.segmentIds, ...item.segmentIds])];
          continue;
        }
        merged[field].push(item);
      }
    }
  }

  const hasContent =
    merged.notes.length > 0 ||
    merged.actions.length > 0 ||
    merged.openQuestions.length > 0 ||
    merged.listAdditions.length > 0;
  return hasContent ? merged : null;
}

/**
 * Turn a transcript into a note.
 *
 * @returns null when nothing usable came back — a complete answer, not a failure:
 *   the deterministic note is already written, so "no improvement" costs the user
 *   nothing.
 */
export async function summarize(
  request: EnhanceRequest,
  generate: Generate,
): Promise<ResolvedEnhancement | null> {
  if (request.transcript.length === 0) return null;

  const windows = splitForContext(request.transcript);
  const authorisedSubjects = request.expansions.map((expansion) =>
    expansion.subject.trim().toLowerCase(),
  );
  const parts: ResolvedEnhancement[] = [];

  for (const [index, window] of windows.entries()) {
    request.onProgress?.({
      stage: 'generating',
      ratio: windows.length > 1 ? index / windows.length : null,
      window: { index: index + 1, total: windows.length },
    });

    const prompt = buildPrompt(window, {
      language: request.language,
      existingBody: request.existing?.body,
      profile: request.profile,
      intent: request.intent,
      expansions: request.expansions,
      isPartial: windows.length > 1,
    });

    const reply = await generate(prompt);
    const parsed = parseEnhancement(reply, { lineCount: window.length, authorisedSubjects });
    if (!parsed) {
      // A window the model made nothing of is skipped rather than fatal: the rest
      // of the recording still has something to say, and one bad reply should not
      // cost the user the whole note.
      logger.warn('The model returned nothing usable for one window');
      continue;
    }

    parts.push({
      title: parsed.title,
      notes: parsed.notes.map((item) => resolveItem(item, window)),
      actions: parsed.actions.map((item) => resolveItem(item, window)),
      openQuestions: parsed.openQuestions.map((item) => resolveItem(item, window)),
      listAdditions: parsed.listAdditions.map((item) => resolveItem(item, window)),
    });
  }

  return merge(parts);
}
