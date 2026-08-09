/**
 * Turning what the model understood into the note.
 *
 * The same rules the rule-based structurer follows, because the user should not
 * be able to tell which one wrote their note apart from it being better:
 *
 * - What the person typed themselves comes first, verbatim. A note that
 *   overwrote what somebody wrote during their own meeting would be worse than
 *   no note at all — and the model is the more dangerous of the two writers here,
 *   because it is confident and fluent.
 * - A title they gave is theirs. Only an untitled note takes the model's.
 * - Their checklist keeps its order and its ticks, and a task they already wrote
 *   is not added again because the model also noticed it.
 * - An empty section is omitted. "Decisions: none" reads as a finding about the
 *   meeting; no heading reads as what it is.
 */

import type { ChecklistItem, Note } from '@noted/shared-types';

import type { Enhancement } from '@/lib/enhance/contract';
import { DEFAULT_LABELS, type ExistingNote, type StructureLabels } from '@/lib/structure/structure';

/** Compare the way a reader would: case and trailing punctuation are not content. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/[.,;:!?]+$/, '');
}

function renderSection(heading: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  return [`## ${heading}`, '', ...lines.map((line) => `- ${line}`), ''];
}

export interface ApplyOptions {
  makeId: () => string;
  existing?: ExistingNote;
  labels?: StructureLabels;
  /** Names the note when neither the user nor the model gave it one. */
  fallbackTitle: string;
}

/**
 * Build the note fields from an enhancement.
 *
 * Returns the same `Partial<Note>` the deterministic path returns, so the caller
 * writes one of them without caring which.
 */
export function enhancementToNotePatch(
  enhancement: Enhancement,
  options: ApplyOptions,
): Partial<Note> {
  const labels = options.labels ?? DEFAULT_LABELS;
  const existing = options.existing;

  const existingItems = existing?.checklist ?? [];
  const alreadyListed = new Set(existingItems.map((item) => normalise(item.text)));
  const checklist: ChecklistItem[] = [
    ...existingItems,
    ...enhancement.actions
      .filter((action) => !alreadyListed.has(normalise(action)))
      .map((action) => ({ id: options.makeId(), text: action, checked: false })),
  ];

  const written = existing?.body.trim() ?? '';
  const body = [
    ...(written ? [written, ''] : []),
    ...renderSection(labels.summary, enhancement.summary),
    ...renderSection(labels.decisions, enhancement.decisions),
    ...renderSection(labels.questions, enhancement.questions),
    // Tasks are the checklist, so the body links to them rather than repeating
    // them — two copies of a task list disagree the moment one is ticked.
  ]
    .join('\n')
    .trim();

  return {
    title: existing?.title.trim() || enhancement.title.trim() || options.fallbackTitle,
    body,
    checklist,
  };
}
