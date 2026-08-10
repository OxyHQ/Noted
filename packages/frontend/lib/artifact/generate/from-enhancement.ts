/**
 * What the model understood, as the same artifact everything else produces.
 *
 * The model and the rule-based pass used to build different shapes and render
 * them through different code, so a note quietly changed structure depending on
 * whether a model happened to be installed. They converge here: one shape, one
 * composer, one renderer. The user should not be able to tell which one wrote
 * their note apart from it being better.
 *
 * ## Grounding is now checked, not guessed
 *
 * The first version of this file matched a model's sentence against the
 * transcript by similarity and cited whatever looked closest. That was honest
 * about its own weakness and still a guess. The model is now asked which lines it
 * used, those references are validated against the lines it was actually shown,
 * and what arrives here is a list of real segment ids. An item that cites nothing
 * gets no sources — visibly ungrounded, rather than quietly indistinguishable
 * from one that is.
 *
 * ## Derived items
 *
 * The only route by which knowledge the recording does not contain may enter a
 * note, and it is closed unless the user opened it out loud. An item claiming a
 * subject nobody authorised never reaches this file — the parser drops it — and
 * one that does carries the sentence that authorised it, so a reader can see both
 * that it was added and why.
 */

import type { PendingExpansion } from '@/lib/artifact/types';
import type { ResolvedEnhancement, ResolvedItem } from '@/lib/enhance/summarize';
import { itemId } from '@/lib/artifact/item-id';
import type {
  ArtifactStage,
  CaptureProfile,
  DocumentIntent,
  GeneratedChecklist,
  GeneratedChecklistItem,
  GeneratedItem,
  GeneratedNoteArtifact,
  SourceRange,
} from '@/lib/artifact/types';
import { checklistKindFor } from '@/lib/artifact/dictation/list';

export interface FromEnhancementInput {
  enhancement: ResolvedEnhancement;
  captureId: string;
  noteId: string;
  stage: ArtifactStage;
  profile: CaptureProfile;
  intent: DocumentIntent;
  /** What the user authorised, so a derived item can cite the sentence that did. */
  expansions: readonly PendingExpansion[];
  transcriptRevision: number;
  now: string;
  /** Names the note when the model returned no title of its own. */
  fallbackTitle: string;
}

function sourcesOf(item: ResolvedItem, captureId: string): SourceRange[] {
  if (item.segmentIds.length === 0) return [];
  return [
    {
      captureId,
      startMs: item.atMs ?? 0,
      endMs: item.atMs ?? 0,
      segmentIds: [...item.segmentIds],
    },
  ];
}

function toItem(
  kind: string,
  item: ResolvedItem,
  input: FromEnhancementInput,
): GeneratedItem {
  const derived = item.derived
    ? input.expansions.find(
        (expansion) => expansion.subject.trim().toLowerCase() === item.derived?.subject,
      )
    : undefined;

  return {
    id: itemId(kind, item.text),
    text: item.text.trim(),
    status: 'active',
    // A derived item without its authorisation would be indistinguishable from
    // something a speaker said. If the receipt is missing the item is reported as
    // ordinary transcript content — which it then has to be grounded like.
    origin: derived ? 'derived-from-instruction' : 'transcript',
    sources: sourcesOf(item, input.captureId),
    ...(derived
      ? {
          instructionSource: derived.instructionSource,
          derivationReason: item.derived?.reason ?? derived.subject,
        }
      : {}),
  };
}

export function enhancementToArtifact(input: FromEnhancementInput): GeneratedNoteArtifact {
  const { enhancement, captureId } = input;

  const notes = enhancement.notes.map((item) => toItem('note', item, input));
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
    profile: input.profile,
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
    // The model's notes ARE the note, so they carry no heading — the same shape
    // the deterministic pass produces, which is what keeps the note's structure
    // from depending on whether a model was installed.
    // Each note becomes its own PARAGRAPH rather than a line of one list. The
    // model writes connected reasoning, and a bullet list asserts that its lines
    // are peers — which destroys the connection rather than styling it badly.
    // The canonical document schema (sections with headings) lands next; this is
    // the domain being able to hold it.
    sections:
      notes.length > 0
        ? [
            {
              id: `section:${captureId}:notes`,
              kind: 'notes' as const,
              blocks: notes.map((note) => ({ ...note, kind: 'paragraph' as const })),
            },
          ]
        : [],
    checklists,
    openQuestions: questions,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
