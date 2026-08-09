/**
 * Turning a recording's transcript into the note a person reads.
 *
 * This is the level that runs everywhere, with nothing downloaded and no model:
 * the same result on a five-year-old Android as on a new iPhone. A device with
 * an on-device LLM available rewrites this output afterwards; a device without
 * one keeps it. Either way the note is never empty and never waits.
 */

import type { ChecklistItem } from '@noted/shared-types';
import type { TranscriptSegment } from '@/lib/capture/captures-repo';

import { cleanSpeech } from '@/lib/structure/clean';
import { extractHighlights, selectOpenQuestions, type Highlight } from '@/lib/structure/extract';
import { selectKeyPoints } from '@/lib/structure/keypoints';
import { groupIntoBlocks } from '@/lib/structure/segment';
import { dropNearDuplicates, normaliseForComparison } from '@/lib/structure/similar';

/** How long a generated title may run before it is cut at a word boundary. */
const MAX_TITLE_CHARS = 60;

/** Section headings, so a caller can translate them without reaching into the text. */
export interface StructureLabels {
  decisions: string;
  questions: string;
}

export const DEFAULT_LABELS: StructureLabels = {
  decisions: 'Decisions',
  questions: 'Open questions',
};

export interface StructuredNote {
  title: string;
  /** The note body, as Markdown — the points, not the transcript. */
  markdown: string;
  /** Action items, ready to become the note's checklist. */
  checklist: ChecklistItem[];
  /**
   * The cleaned transcript, for the recording's own view.
   *
   * Separate from the note on purpose: a note that reproduces everything said
   * is a transcript with headings, and skimming it back is exactly the work the
   * app exists to save.
   */
  transcript: { atMs: number; text: string }[];
}

/**
 * What the user themselves put in the note while the meeting was happening.
 *
 * The whole point of recording in the background is that the person keeps typing
 * their own sparse notes; the transcript is there to enrich those, never to
 * replace them. Anything typed here is reproduced verbatim and first.
 */
export interface ExistingNote {
  title: string;
  body: string;
  checklist: readonly ChecklistItem[];
}

/**
 * What a writer contributes to a note.
 *
 * `body` here is that writer's own output and nothing else — never the note's
 * body. Both writers are handed an empty `existing.body` precisely so this field
 * carries their contribution alone, which is what the store then composes with
 * the user's half.
 */
export interface NoteFields {
  title: string;
  body: string;
  checklist: ChecklistItem[];
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

/**
 * A title from the recording's own first words.
 *
 * Not keyword extraction: the opening of a meeting is usually someone saying
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

function renderSection(heading: string, lines: readonly string[]): string[] {
  // An empty section is omitted entirely. "Decisions: none" reads as a finding
  // about the meeting; the absence of the heading reads as what it is.
  if (lines.length === 0) return [];
  return [`## ${heading}`, '', ...lines, ''];
}

/**
 * Build the note.
 *
 * `startedAt` names the recording when nothing else can, and `makeId` mints
 * checklist ids — passed in so this module stays pure and its output is
 * reproducible in a test.
 */
export function structureTranscript(
  segments: readonly TranscriptSegment[],
  options: {
    startedAt: Date;
    makeId: () => string;
    labels?: StructureLabels;
    /** What the user wrote during the meeting. Kept, never overwritten. */
    existing?: ExistingNote;
  },
): StructuredNote {
  const labels = options.labels ?? DEFAULT_LABELS;
  const existing = options.existing;

  const blocks = groupIntoBlocks(segments)
    .map((block) => ({ ...block, text: cleanSpeech(block.text) }))
    .filter((block) => block.text !== '');

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

  // The user's own items come first and keep their ticked state. A task they
  // already wrote down is not added again just because it was also said aloud.
  const existingItems = existing?.checklist ?? [];
  const alreadyListed = new Set(existingItems.map((item) => normaliseForComparison(item.text)));
  const checklist: ChecklistItem[] = [
    ...existingItems,
    ...actions
      .filter((action) => !alreadyListed.has(normaliseForComparison(action.text)))
      .map((action) => ({ id: options.makeId(), text: action.text, checked: false })),
  ];

  const written = existing?.body.trim() ?? '';
  const markdown = [
    // What the person wrote comes first, verbatim and unedited. The transcript
    // is here to enrich their notes, not to replace them — a note that
    // overwrote what somebody typed during their own meeting would be worse
    // than no note at all.
    ...(written ? [written, ''] : []),
    // The points carry no heading: they ARE the note, not a section of it — the
    // same shape the model-written note has, so a device that later rewrites
    // this one does not change the note's structure, only its wording.
    ...(points.length > 0 ? [...points.map((point) => `- ${point.text}`), ''] : []),
    // Tasks are also the checklist, so the body links to them rather than
    // repeating them — two copies of a task list disagree the moment one is
    // ticked.
    ...renderSection(
      labels.decisions,
      decisions.map((decision) => `- ${decision.text}`),
    ),
    ...renderSection(
      labels.questions,
      questions.map((question) => `- ${question.text}`),
    ),
    // The transcript is deliberately NOT here. A note that reproduces everything
    // said is a transcript with headings, and reading it back is the work the
    // app was supposed to do. What belongs in a note is the handful of things
    // worth returning to; the full text stays available in the recording's own
    // view for when somebody needs to check a wording.
  ]
    .join('\n')
    .trim();

  return {
    // A title the user typed is theirs; only an untitled note gets one derived.
    title: existing?.title.trim() || deriveTitle(blocks, options.startedAt.toLocaleString()),
    markdown,
    checklist,
    transcript: blocks.map((block) => ({ atMs: block.startMs, text: block.text })),
  };
}

/** The fields {@link structureTranscript} contributes to a note. */
export function toNotePatch(structured: StructuredNote): NoteFields {
  return {
    title: structured.title,
    body: structured.markdown,
    checklist: structured.checklist,
  };
}
