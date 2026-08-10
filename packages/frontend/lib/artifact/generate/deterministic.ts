/**
 * The note anyone gets, with nothing downloaded.
 *
 * This is the floor: the same result on a five-year-old Android as on a new
 * iPhone, running while the recording is still going, with no model and no
 * network. A device with a language model rewrites this afterwards — and writes
 * the SAME shape, a `GeneratedNoteArtifact`, which is the point. The note's
 * structure no longer depends on whether a model happened to be installed; only
 * its quality does.
 *
 * Extractive, never generative. Every line here is a sentence somebody said, and
 * each one carries the segments it came from, so nothing this module produces can
 * be a claim nobody made.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { cleanSpeech } from '@/lib/structure/clean';
import { extractHighlights, selectOpenQuestions, type Highlight } from '@/lib/structure/extract';
import { selectKeyPoints } from '@/lib/structure/keypoints';
import { groupIntoBlocks, type Block } from '@/lib/structure/segment';
import { dropNearDuplicates } from '@/lib/structure/similar';
import { itemId } from '@/lib/artifact/item-id';
import { parseListCommands } from '@/lib/artifact/dictation/instructions';
import { buildDictatedList } from '@/lib/artifact/dictation/list';
import { classifyProfile, resolveProfile, spokenProfile } from '@/lib/artifact/profile';
import {  } from '@noted/shared-types';
import { type ArtifactLabels, DEFAULT_ARTIFACT_LABELS } from '@/lib/artifact/types';
import type { ArtifactStage, CaptureProfile, DocumentIntent, GeneratedChecklistItem, GeneratedItem, GeneratedNoteArtifact, GeneratedSection, SourceRange } from '@noted/shared-types';

/** How long a generated title may run before it is cut at a word boundary. */
const MAX_TITLE_CHARS = 60;

export interface DeterministicInput {
  noteId: string;
  captureId: string;
  segments: readonly TranscriptSegment[];
  /** Names the recording when it has nothing to take a title from. */
  startedAt: Date;
  stage: ArtifactStage;
  profile?: CaptureProfile;
  intent?: DocumentIntent;
  transcriptRevision: number;
  now: string;
  /** So the highlights heading can be in the user's language. */
  labels?: ArtifactLabels;
}

/**
 * A title from the recording's own first words.
 *
 * Not keyword extraction: the opening of a meeting is usually somebody saying
 * what it is about, and a phrase the user recognises beats a bag of nouns they
 * have to decode. `fallback` (the start time) is used when there is nothing to
 * take — a recording of silence still needs a name.
 */
export function deriveTitle(blocks: readonly { text: string }[], fallback: string): string {
  const opening = blocks[0]?.text.trim();
  if (!opening) return fallback;

  const firstSentence = opening.split(/(?<=[.!?])\s+/)[0]?.trim() ?? opening;
  if (firstSentence.length <= MAX_TITLE_CHARS) return firstSentence.replace(/[.!?]+$/, '');

  // Cut at a word boundary: a title ending mid-word reads as broken rather than
  // as abbreviated.
  const clipped = firstSentence.slice(0, MAX_TITLE_CHARS);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).replace(/[.,;:]+$/, '')}…`;
}

/**
 * The cleaned, block-grouped transcript.
 *
 * Exported because the model path wants exactly this and not whisper's raw
 * segments: the filler and the repetitions `cleanSpeech` removes are tokens a
 * phone's context window would otherwise spend on nothing.
 */
export function cleanedBlocks(segments: readonly TranscriptSegment[]): Block[] {
  return groupIntoBlocks(segments)
    .map((block) => ({ ...block, text: cleanSpeech(block.text) }))
    .filter((block) => block.text !== '');
}

/**
 * The block a sentence was said in, by its start time.
 *
 * The extractors report `atMs` — the start of the block they read — which is what
 * makes this lookup exact rather than a nearest-match.
 */
function sourceAt(blocks: readonly Block[], captureId: string, atMs: number): SourceRange[] {
  const block = blocks.find((candidate) => candidate.startMs === atMs);
  if (!block) return [];
  return [
    { captureId, startMs: block.startMs, endMs: block.endMs, segmentIds: [...block.segmentIds] },
  ];
}

function toItem(
  kind: string,
  text: string,
  atMs: number,
  blocks: readonly Block[],
  captureId: string,
): GeneratedItem {
  return {
    id: itemId(kind, text),
    text,
    status: 'active',
    origin: 'transcript',
    sources: sourceAt(blocks, captureId, atMs),
  };
}

function byKind(highlights: readonly Highlight[], kind: Highlight['kind']): Highlight[] {
  return highlights.filter((highlight) => highlight.kind === kind);
}

/**
 * Drop repeats.
 *
 * People restate a commitment several times in a meeting — when it is raised,
 * when it is agreed, and again in the wrap-up — and the recogniser rarely writes
 * the restatement identically, which is why this compares by similarity rather
 * than by exact text.
 */
function dedupe(highlights: readonly Highlight[]): Highlight[] {
  return dropNearDuplicates(highlights, (highlight) => highlight.text);
}

export function buildDeterministicArtifact(input: DeterministicInput): GeneratedNoteArtifact {
  const labels = input.labels ?? DEFAULT_ARTIFACT_LABELS;
  const blocks = cleanedBlocks(input.segments);
  const captureId = input.captureId;

  const commands = parseListCommands(blocks);
  const profile = resolveProfile({
    selected: input.profile,
    spoken: spokenProfile(blocks),
    classified: classifyProfile(blocks, commands),
  });
  const dictated = buildDictatedList({
    commands,
    captureId,
    sourceAt: (atMs) => sourceAt(blocks, captureId, atMs),
  });

  // A recording that IS a dictation is the list, and nothing else. Reading the
  // instruction back as a bullet — "quiero una lista de la compra" — is the app
  // narrating the user to themselves. A list dictated inside a meeting is a
  // different case, and there both survive.
  const listOnly = profile === 'dictation' && dictated.checklist !== null;

  /**
   * Whether this recording's commitments are worth trusting an extractor with.
   *
   * A talk is full of "we have to" — "we have to evolve as humans", "what we have
   * to do is think faster" — and none of it is a task anybody agreed to. The
   * patterns cannot tell rhetoric from a commitment, and this module's own rule
   * is precision over recall: a missed task is a line the user can still read in
   * the transcript, an invented one is a commitment nobody made in a note they
   * trust.
   *
   * The cost is real and worth stating: a lecturer who genuinely sets homework
   * loses it from the checklist here. It stays in the transcript, and the model —
   * which does run for these profiles and can tell an assignment from a
   * rhetorical flourish — can still produce it.
   */
  const extractsActions = profile !== 'event' && profile !== 'lecture';

  const highlights = dedupe(
    blocks.flatMap((block) => extractHighlights(block.text, block.startMs)),
  );

  const actions = byKind(highlights, 'action');
  const decisions = byKind(highlights, 'decision');
  // Not `byKind(highlights, 'question')`: whether a question is still open is a
  // property of what was said AFTER it, which one block cannot see.
  const questions = dedupe(selectOpenQuestions(blocks));
  // The note itself — what was said, rather than only the four things a meeting
  // happens to produce. Without this a talk with no tasks and no decisions
  // structured down to a list of the speaker's rhetorical questions, with every
  // word of the content missing.
  const points = selectKeyPoints(blocks);

  const title = deriveTitle(blocks, input.startedAt.toLocaleString());
  const checklistItems: GeneratedChecklistItem[] = actions.map((action) => ({
    ...toItem('action', action.text, action.atMs, blocks, captureId),
    checked: false,
  }));

  return {
    id: `artifact:${captureId}:${input.stage}`,
    noteId: input.noteId,
    captureId,
    stage: input.stage,
    profile,
    intent: input.intent ?? dictated.intent,
    transcriptRevision: input.transcriptRevision,
    artifactRevision: 0,
    title: {
      id: itemId('title', title),
      text: title,
      status: 'active',
      origin: blocks.length > 0 ? 'transcript' : 'legacy',
      // The date fallback came from a clock, not from the recording, so it
      // claims no source. `legacy` is the only origin that means "not grounded
      // and not derived either", which is exactly what it is.
      sources: blocks.length > 0 ? sourceAt(blocks, captureId, blocks[0].startMs) : [],
    },
    sections: listOnly
      ? []
      : (
      [
        // The points carry no heading: they ARE the note, not a section of it.
        {
          id: `section:${captureId}:notes`,
          kind: 'notes',
          // A bullet list, and labelled as highlights rather than dressed up as a
          // finished document. This pass SELECTS sentences somebody said; it
          // cannot rewrite first-person speech into prose about the speaker, and
          // pretending otherwise with a heading like "Notes" is what made a talk
          // read as though the speaker had written it.
          heading: points.length > 0 ? labels.highlights : undefined,
          blocks:
            points.length > 0
              ? [
                  {
                    id: `block:${captureId}:points`,
                    kind: 'bullet-list' as const,
                    status: 'active' as const,
                    origin: 'transcript' as const,
                    sources: [],
                    items: points.map((point) =>
                      toItem('note', point.text, point.atMs, blocks, captureId),
                    ),
                  },
                ]
              : [],
        },
        {
          id: `section:${captureId}:decisions`,
          kind: 'decisions',
          blocks:
            decisions.length > 0
              ? [
                  {
                    id: `block:${captureId}:decisions`,
                    kind: 'bullet-list' as const,
                    status: 'active' as const,
                    origin: 'transcript' as const,
                    sources: [],
                    items: decisions.map((decision) =>
                      toItem('decision', decision.text, decision.atMs, blocks, captureId),
                    ),
                  },
                ]
              : [],
        },
      ] satisfies GeneratedSection[]
    ).filter((section) => section.blocks.length > 0),
    checklists: [
      // What was dictated comes first: the user asked for it in so many words.
      ...(dictated.checklist ? [dictated.checklist] : []),
      ...(checklistItems.length > 0 && !listOnly && extractsActions
        ? [
            {
              id: `checklist:${captureId}:actions`,
              kind: 'actions' as const,
              items: checklistItems,
            },
          ]
        : []),
    ],
    openQuestions: listOnly
      ? []
      : questions.map((question) =>
          toItem('question', question.text, question.atMs, blocks, captureId),
        ),
    pendingExpansions: dictated.pendingExpansions,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
