/**
 * Putting the user's note and the app's artifact together.
 *
 * There is exactly one of these, and everything that shows a note goes through
 * it: the card, the open editor, the export, the row that syncs. A second place
 * that assembled a note would be a second opinion about who owns what, and the
 * bug that produces is not subtle — it is somebody's typing disappearing.
 *
 * The rules it enforces:
 *
 * - What the user wrote comes first and comes back verbatim. They were in the
 *   room and chose to type that.
 * - A title they gave is theirs. Only an untitled note takes a generated one, and
 *   a settled title beats a provisional one.
 * - Their checklist keeps its order and its ticks, and a task they already wrote
 *   down is not added again because it was also said out loud.
 * - Generated content is never hidden to make room for user content. Both are
 *   shown; the user's is simply first.
 */

import type { ChecklistItem } from '@noted/shared-types';

import {
  DEFAULT_ARTIFACT_LABELS,
  type ArtifactLabels,
  type GeneratedNoteArtifact,
} from '@/lib/artifact/types';
import { nonEmptyChecklists } from '@/lib/artifact/artifact';
import { applyOverrides, overridesById, type UserItemOverride } from '@/lib/artifact/ownership';
import { renderArtifact } from '@/lib/artifact/render';
import { isNearDuplicate } from '@/lib/structure/similar';

/** What the user themselves owns. Never rewritten by any generator. */
export interface UserContent {
  title: string;
  body: string;
  checklist: readonly ChecklistItem[];
}

export interface ComposeInput {
  user: UserContent;
  /** The provisional artifact, written while somebody is still talking. */
  live?: GeneratedNoteArtifact | null;
  /** The settled artifact, written once the whole recording was reconciled. */
  final?: GeneratedNoteArtifact | null;
  overrides?: readonly UserItemOverride[];
  /** Names the note when neither the user nor any generator did — the capture date. */
  fallbackTitle: string;
  labels?: ArtifactLabels;
}

export interface ComposedNote {
  title: string;
  /** The whole body, user half first. */
  body: string;
  /** The app's half alone, which the store remembers so the next pass can replace it. */
  generatedBody: string;
  checklist: ChecklistItem[];
}

/** Blank line between the halves, so Markdown keeps them as separate blocks. */
const SEPARATOR = '\n\n';

/**
 * Which artifact the reader should be shown.
 *
 * Final wins whenever it exists. A live pass has read part of the recording and
 * the finaliser has read all of it, so once the settled version exists the
 * provisional one is not a fallback, it is an older draft.
 */
export function preferredArtifact(input: ComposeInput): GeneratedNoteArtifact | null {
  return input.final ?? input.live ?? null;
}

export function composeNote(input: ComposeInput): ComposedNote {
  const labels = input.labels ?? DEFAULT_ARTIFACT_LABELS;
  const overrides = overridesById(input.overrides ?? []);

  const source = preferredArtifact(input);
  const artifact = source ? applyOverrides(source, overrides) : null;

  const userBody = input.user.body.trim();
  const generatedBody = artifact ? renderArtifact(artifact, labels) : '';

  return {
    title: composeTitle(input, overrides),
    body: [userBody, generatedBody].filter((half) => half !== '').join(SEPARATOR),
    generatedBody,
    checklist: composeChecklist(input, artifact),
  };
}

function composeTitle(input: ComposeInput, overrides: ReturnType<typeof overridesById>): string {
  const userTitle = input.user.title.trim();
  if (userTitle !== '') return userTitle;

  // Final before live, and each only if the user did not delete it.
  for (const artifact of [input.final, input.live]) {
    const title = artifact?.title;
    if (!title) continue;
    if (overrides.get(title.id)?.removed) continue;
    const text = (overrides.get(title.id)?.text ?? title.text).trim();
    if (text !== '') return text;
  }
  return input.fallbackTitle;
}

/**
 * The note's checklist: the user's items, then the generated ones.
 *
 * The generated half is flattened out of every checklist the artifact holds —
 * actions, a shopping list, packing — because a note has one checklist and the
 * artifact's grouping is a presentation detail the editor renders, not a second
 * list to store.
 *
 * Comparison is by similarity rather than by exact text: somebody who typed
 * "llamar al banco" should not get "Llamar al banco." added underneath it because
 * the recogniser punctuated it differently.
 */
function composeChecklist(
  input: ComposeInput,
  artifact: GeneratedNoteArtifact | null,
): ChecklistItem[] {
  const userItems = [...input.user.checklist];
  if (!artifact) return userItems;

  const composed: ChecklistItem[] = [...userItems];
  for (const checklist of nonEmptyChecklists(artifact)) {
    for (const item of checklist.items) {
      const text = item.quantity ? `${item.quantity} ${item.text}` : item.text;
      if (composed.some((existing) => isNearDuplicate(existing.text, text))) continue;
      composed.push({ id: item.id, text, checked: item.checked });
    }
  }
  return composed;
}
