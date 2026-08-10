/**
 * What the model understood, as the same artifact everything else produces.
 *
 * The model and the rule-based pass used to build different shapes and render
 * them through different code, so a note quietly changed structure depending on
 * whether a model happened to be installed. They converge here: one shape, one
 * composer, one renderer.
 *
 * What is new is that the model's shape is now a DOCUMENT. It returns sections
 * with headings and blocks — paragraphs, lists, quotations — rather than four
 * arrays of short lines, so a paragraph survives the trip instead of being
 * flattened into a bullet on the way in.
 *
 * ## Grounding is checked, not guessed
 *
 * The model is asked which transcript lines it used, those references are
 * validated against the lines it was actually shown, and what arrives here is a
 * list of real segment ids. A block that cites nothing gets no sources — visibly
 * ungrounded, rather than quietly indistinguishable from one that is.
 */

import type { PendingExpansion } from '@/lib/artifact/types';
import type { ResolvedBlock, ResolvedEnhancement, ResolvedItem } from '@/lib/enhance/contract';
import { itemId } from '@/lib/artifact/item-id';
import type {
  ArtifactStage,
  CaptureProfile,
  DocumentIntent,
  GeneratedBlock,
  GeneratedChecklist,
  GeneratedChecklistItem,
  GeneratedItem,
  GeneratedNoteArtifact,
  GeneratedSection,
  SourceRange,
} from '@/lib/artifact/types';
import { checklistKindFor } from '@/lib/artifact/dictation/list';

export interface FromEnhancementInput {
  enhancement: ResolvedEnhancement;
  captureId: string;
  noteId: string;
  stage: ArtifactStage;
  /** What the USER chose. `auto` lets the model's own reading through. */
  profile: CaptureProfile;
  intent: DocumentIntent;
  /** What the user authorised, so a derived item can cite the sentence that did. */
  expansions: readonly PendingExpansion[];
  transcriptRevision: number;
  now: string;
  /** Names the note when the model returned no title of its own. */
  fallbackTitle: string;
}

function sourcesOf(
  resolved: { segmentIds: string[]; atMs: number | null },
  captureId: string,
): SourceRange[] {
  if (resolved.segmentIds.length === 0) return [];
  return [
    {
      captureId,
      startMs: resolved.atMs ?? 0,
      endMs: resolved.atMs ?? 0,
      segmentIds: [...resolved.segmentIds],
    },
  ];
}

/**
 * Whether this is knowledge Noted supplied, and the receipt for it.
 *
 * A derived item without its authorisation would be indistinguishable from
 * something a speaker said. If the receipt is missing it is reported as ordinary
 * transcript content — which it then has to be grounded like, and usually is not.
 */
function derivationOf(
  item: ResolvedItem,
  input: FromEnhancementInput,
): Pick<GeneratedItem, 'origin' | 'instructionSource' | 'derivationReason'> {
  const authorised = item.derived
    ? input.expansions.find(
        (expansion) => expansion.subject.trim().toLowerCase() === item.derived?.subject,
      )
    : undefined;

  return authorised
    ? {
        origin: 'derived-from-instruction',
        instructionSource: authorised.instructionSource,
        derivationReason: item.derived?.reason ?? authorised.subject,
      }
    : { origin: 'transcript' };
}

function toItem(kind: string, item: ResolvedItem, input: FromEnhancementInput): GeneratedItem {
  return {
    id: itemId(kind, item.text),
    text: item.text.trim(),
    status: 'active',
    sources: sourcesOf(item, input.captureId),
    ...derivationOf(item, input),
  };
}

/**
 * One block of the model's document.
 *
 * Its id comes from its content for the same reason every other id does: a
 * paragraph recognised again in a later pass has to be the same paragraph, or
 * the note rearranges itself under the reader.
 */
function toBlock(block: ResolvedBlock, input: FromEnhancementInput): GeneratedBlock | null {
  const base = {
    status: 'active' as const,
    origin: 'transcript' as const,
    sources: sourcesOf(block, input.captureId),
  };

  if (block.type === 'bullet-list' || block.type === 'numbered-list') {
    const items = (block.items ?? []).map((item) => toItem('list', item, input));
    if (items.length === 0) return null;
    return {
      ...base,
      id: itemId(block.type, items.map((item) => item.text).join('|')),
      kind: block.type,
      items,
    };
  }

  const text = (block.text ?? '').trim();
  if (text === '') return null;

  if (block.type === 'quote') {
    return {
      ...base,
      id: itemId('quote', text),
      kind: 'quote',
      text,
      ...(block.attribution === undefined ? {} : { attribution: block.attribution }),
    };
  }
  return { ...base, id: itemId('paragraph', text), kind: 'paragraph', text };
}

export function enhancementToArtifact(input: FromEnhancementInput): GeneratedNoteArtifact {
  const { enhancement, captureId } = input;

  const sections: GeneratedSection[] = enhancement.sections
    .map((section, index) => ({
      id: `section:${captureId}:${String(index)}`,
      kind: 'notes' as const,
      ...(section.heading === undefined ? {} : { heading: section.heading }),
      blocks: section.blocks
        .map((block) => toBlock(block, input))
        .filter((block): block is GeneratedBlock => block !== null),
    }))
    .filter((section) => section.blocks.length > 0);

  const questions = enhancement.openQuestions.map((item) => toItem('question', item, input));

  const actions: GeneratedChecklistItem[] = enhancement.actions.map((item) => ({
    ...toItem('action', item, input),
    checked: false,
  }));

  // What the model was asked to complete goes in the list the user dictated, not
  // in a second one beside it: they asked for one list.
  const additions: GeneratedChecklistItem[] = enhancement.listAdditions.map((item) => ({
    ...toItem('list', item, input),
    checked: false,
  }));

  const checklists: GeneratedChecklist[] = [
    ...(additions.length > 0
      ? [
          {
            id: `checklist:${captureId}:dictated`,
            kind: checklistKindFor(input.intent),
            items: additions,
          },
        ]
      : []),
    ...(actions.length > 0
      ? [{ id: `checklist:${captureId}:actions`, kind: 'actions' as const, items: actions }]
      : []),
  ];

  const title = enhancement.title.trim() || input.fallbackTitle;

  return {
    id: `artifact:${captureId}:${input.stage}`,
    noteId: input.noteId,
    captureId,
    stage: input.stage,
    // The model's reading of what this is, but only when the user did not say.
    // Their choice always wins, which is why theirs is checked first.
    profile: input.profile === 'auto' ? (enhancement.profile ?? 'auto') : input.profile,
    intent: input.intent,
    transcriptRevision: input.transcriptRevision,
    artifactRevision: 0,
    title: {
      id: itemId('title', title),
      text: title,
      status: 'active',
      origin: 'transcript',
      sources: [],
    },
    people: enhancement.people.map((person, index) => ({
      id: `person:${captureId}:${String(index)}`,
      ...(person.name === undefined ? {} : { name: person.name }),
      ...(person.role === undefined ? {} : { role: person.role }),
      ...(person.organization === undefined ? {} : { organization: person.organization }),
      sources: sourcesOf(person, captureId),
    })),
    sections,
    checklists,
    openQuestions: questions,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
