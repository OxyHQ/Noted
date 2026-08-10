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
  EnhancementBlock,
  EnhancementListItem,
  EnhancementSection,
  Resolved,
  ResolvedBlock,
  ResolvedEnhancement,
  ResolvedItem,
  ResolvedSection,
} from '@/lib/enhance/contract';
import { parseEnhancement } from '@/lib/enhance/parse';
import type { ParseDiagnostics, ParseFailureReason } from '@/lib/enhance/parse';
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
/**
 * Run the model on one prompt.
 *
 * `lineCount` is how many transcript lines this window holds, and it is here so
 * a backend can size the reply budget against how much there is to say. A fixed
 * budget is what truncated the document and reported it as a device limitation.
 */
export type Generate = (prompt: string, lineCount: number) => Promise<string>;

/** Where a set of cited line numbers points, in the recording. */
function resolve(sources: readonly number[], window: readonly EnhanceLine[]): Resolved {
  const lines = sources.map((source) => window[source - 1]).filter(Boolean);
  return {
    segmentIds: [...new Set(lines.flatMap((line) => line.segmentIds))],
    atMs: lines.length > 0 ? Math.min(...lines.map((line) => line.atMs)) : null,
  };
}

function resolveItem(item: EnhancementListItem, window: readonly EnhanceLine[]): ResolvedItem {
  return {
    text: item.text,
    ...resolve(item.sources, window),
    ...(item.derived ? { derived: item.derived } : {}),
  };
}

function resolveBlock(block: EnhancementBlock, window: readonly EnhanceLine[]): ResolvedBlock {
  return {
    type: block.type,
    ...resolve(block.sources, window),
    ...(block.text === undefined ? {} : { text: block.text }),
    ...(block.attribution === undefined ? {} : { attribution: block.attribution }),
    ...(block.items ? { items: block.items.map((item) => resolveItem(item, window)) } : {}),
  };
}

function resolveSection(
  section: EnhancementSection,
  window: readonly EnhanceLine[],
): ResolvedSection {
  return {
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    blocks: section.blocks.map((block) => resolveBlock(block, window)),
  };
}

/**
 * Combine the answers from several windows into one document.
 *
 * Sections are matched BY HEADING, because that is what a section is: two windows
 * that both wrote "The printing-press analogy" wrote about the same thing, and
 * appending them as separate sections would give the note the same heading twice.
 * Their blocks are concatenated in the order the recording produced them.
 *
 * The title comes from the first window that produced one — the beginning of a
 * recording is where people say what it is about — and so does the profile, for
 * the same reason.
 */
/** What makes two blocks the same block, for merging across windows. */
function blockKey(block: ResolvedBlock): string {
  const body = block.text ?? (block.items ?? []).map((item) => item.text).join('|');
  return `${block.type}:${body.trim().toLowerCase()}`;
}

function merge(parts: readonly ResolvedEnhancement[]): ResolvedEnhancement | null {
  const merged: ResolvedEnhancement = {
    title: '',
    people: [],
    sections: [],
    actions: [],
    openQuestions: [],
    listAdditions: [],
  };

  for (const part of parts) {
    if (merged.title === '' && part.title !== '') merged.title = part.title;
    merged.profile ??= part.profile;

    for (const person of part.people) {
      const already = merged.people.some(
        (candidate) =>
          (candidate.name ?? candidate.role ?? '').toLowerCase() ===
          (person.name ?? person.role ?? '').toLowerCase(),
      );
      if (!already) merged.people.push(person);
    }

    for (const section of part.sections) {
      const existing = merged.sections.find(
        (candidate) =>
          (candidate.heading ?? '').toLowerCase() === (section.heading ?? '').toLowerCase(),
      );
      if (existing) {
        // The same paragraph produced by two windows is one paragraph. Without
        // this, a subject discussed across a window boundary comes back written
        // twice, word for word.
        const already = new Set(existing.blocks.map(blockKey));
        existing.blocks = [
          ...existing.blocks,
          ...section.blocks.filter((block) => !already.has(blockKey(block))),
        ];
      } else {
        merged.sections.push({ ...section, blocks: [...section.blocks] });
      }
    }

    for (const field of ['actions', 'openQuestions', 'listAdditions'] as const) {
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
    merged.sections.length > 0 ||
    merged.actions.length > 0 ||
    merged.openQuestions.length > 0 ||
    merged.listAdditions.length > 0;
  return hasContent ? merged : null;
}

/**
 * What one run of the model produced, or why it produced nothing.
 *
 * This used to be `ResolvedEnhancement | null`, and the caller turned `null`
 * into "this device cannot organize notes". Every window failing because each
 * paragraph was longer than a bullet limit reported as a hardware limitation.
 */
export type SummarizeResult =
  | { ok: true; value: ResolvedEnhancement; diagnostics: ParseDiagnostics[] }
  | {
      ok: false;
      /** The reason from the window that got furthest, not the first to fail. */
      reason: ParseFailureReason | 'no_transcript' | 'no_window_succeeded';
      diagnostics: ParseDiagnostics[];
    };

/**
 * How bad each failure is, so a run over several windows reports the most
 * informative reason rather than whichever window failed first.
 *
 * `truncated` outranks the rest deliberately: it is the one that names a
 * remedy — generate again with more room — so it must not be hidden behind a
 * window that merely had nothing to say.
 */
const REASON_RANK: Record<ParseFailureReason, number> = {
  truncated: 6,
  all_content_dropped: 5,
  malformed_json: 4,
  schema_rejected: 3,
  no_json_object: 2,
  reply_too_long: 2,
  nothing_useful: 1,
};

/**
 * Turn a transcript into a note.
 *
 * A window the model made nothing of is skipped rather than fatal — the rest of
 * the recording still has something to say. What is NOT skipped is the reason:
 * if no window survives, the worst reason seen is what the caller reports, so a
 * truncated reply never arrives at the user as a statement about their device.
 */
export async function summarize(
  request: EnhanceRequest,
  generate: Generate,
): Promise<SummarizeResult> {
  if (request.transcript.length === 0) {
    return { ok: false, reason: 'no_transcript', diagnostics: [] };
  }

  const windows = splitForContext(request.transcript);
  const authorisedSubjects = request.expansions.map((expansion) =>
    expansion.subject.trim().toLowerCase(),
  );
  const parts: ResolvedEnhancement[] = [];
  const diagnostics: ParseDiagnostics[] = [];
  let worst: ParseFailureReason | null = null;

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

    const reply = await generate(prompt, window.length);
    const result = parseEnhancement(reply, { lineCount: window.length, authorisedSubjects });
    diagnostics.push(result.diagnostics);
    if (!result.ok) {
      // Skipped, but no longer silent. The counts say whether the model answered
      // and we threw it away or never answered at all — and both go to the
      // caller, which is what stops a parser problem being reported as a device
      // problem.
      logger.warn('One window produced no usable document', {
        reason: result.reason,
        blocksDropped: result.diagnostics.blocksDropped,
        oversizeDropped: result.diagnostics.oversizeDropped,
      });
      if (worst === null || REASON_RANK[result.reason] > REASON_RANK[worst]) worst = result.reason;
      continue;
    }
    const parsed = result.value;

    parts.push({
      profile: parsed.profile,
      title: parsed.title,
      people: parsed.people.map((person) => ({
        ...resolve(person.sources, window),
        ...(person.name === undefined ? {} : { name: person.name }),
        ...(person.role === undefined ? {} : { role: person.role }),
        ...(person.organization === undefined ? {} : { organization: person.organization }),
      })),
      sections: parsed.sections.map((section) => resolveSection(section, window)),
      actions: parsed.actions.map((item) => resolveItem(item, window)),
      openQuestions: parsed.openQuestions.map((item) => resolveItem(item, window)),
      listAdditions: parsed.listAdditions.map((item) => resolveItem(item, window)),
    });
  }

  const merged = merge(parts);
  if (!merged) return { ok: false, reason: worst ?? 'no_window_succeeded', diagnostics };
  return { ok: true, value: merged, diagnostics };
}
