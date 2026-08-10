/**
 * What the model understood, as the same artifact everything else produces.
 *
 * The model and the rule-based pass used to build different shapes and render
 * them through different code, so a note quietly changed structure depending on
 * whether a model happened to be installed. They now converge here: one shape,
 * one composer, one renderer. The user should not be able to tell which one wrote
 * their note apart from it being better.
 *
 * ## Grounding, honestly
 *
 * The model writes prose, not quotations, so its sentences rarely appear in the
 * transcript verbatim. Each item is matched against the transcript blocks and
 * cites the one it matches; an item that matches nothing cites NOTHING rather
 * than the block it was probably about. An invented citation is worse than a
 * missing one — a reader who follows it and finds the wrong moment stops trusting
 * every other citation in the note.
 *
 * The model returning segment ids directly is the better answer and belongs with
 * the constrained-output work; this is what is honest until then.
 */

import type { Enhancement } from '@/lib/enhance/contract';
import type { Block } from '@/lib/structure/segment';
import { isNearDuplicate } from '@/lib/structure/similar';
import { itemId } from '@/lib/artifact/item-id';
import type {
  ArtifactStage,
  GeneratedChecklistItem,
  GeneratedItem,
  GeneratedNoteArtifact,
  SourceRange,
} from '@/lib/artifact/types';

/** The block this sentence is about, if one plainly is. */
function sourcesFor(text: string, blocks: readonly Block[], captureId: string): SourceRange[] {
  const block = blocks.find((candidate) => isNearDuplicate(candidate.text, text));
  if (!block) return [];
  return [
    { captureId, startMs: block.startMs, endMs: block.endMs, segmentIds: [...block.segmentIds] },
  ];
}

function toItem(
  kind: string,
  text: string,
  blocks: readonly Block[],
  captureId: string,
): GeneratedItem {
  return {
    id: itemId(kind, text),
    text: text.trim(),
    status: 'active',
    origin: 'transcript',
    sources: sourcesFor(text, blocks, captureId),
  };
}

export interface FromEnhancementInput {
  enhancement: Enhancement;
  captureId: string;
  noteId: string;
  blocks: readonly Block[];
  stage: ArtifactStage;
  transcriptRevision: number;
  now: string;
  /** Names the note when the model returned no title of its own. */
  fallbackTitle: string;
}

export function enhancementToArtifact(input: FromEnhancementInput): GeneratedNoteArtifact {
  const { enhancement, blocks, captureId } = input;

  const notes = enhancement.notes
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .map((text) => toItem('note', text, blocks, captureId));

  const actions: GeneratedChecklistItem[] = enhancement.actions
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .map((text) => ({ ...toItem('action', text, blocks, captureId), checked: false }));

  const questions = enhancement.openQuestions
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .map((text) => toItem('question', text, blocks, captureId));

  const title = enhancement.title.trim() || input.fallbackTitle;

  return {
    id: `artifact:${captureId}:${input.stage}`,
    noteId: input.noteId,
    captureId,
    stage: input.stage,
    profile: 'auto',
    intent: 'freeform',
    transcriptRevision: input.transcriptRevision,
    artifactRevision: 0,
    title: {
      id: itemId('title', title),
      text: title,
      status: 'active',
      origin: 'transcript',
      sources: sourcesFor(title, blocks, captureId),
    },
    // The model's notes ARE the note, so they carry no heading — the same shape
    // the deterministic pass produces, which is what keeps the note's structure
    // from depending on whether a model was installed.
    sections: notes.length > 0 ? [{ id: `section:${captureId}:notes`, kind: 'notes', items: notes }] : [],
    checklists:
      actions.length > 0
        ? [{ id: `checklist:${captureId}:actions`, kind: 'actions', items: actions }]
        : [],
    openQuestions: questions,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
