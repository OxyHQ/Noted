/**
 * Turning a recording's transcript into the note a person reads.
 *
 * This is the level that runs everywhere, with nothing downloaded and no model:
 * the same result on a five-year-old Android as on a new iPhone. A device with
 * an on-device LLM available rewrites this output afterwards; a device without
 * one keeps it. Either way the note is never empty and never waits.
 */

import type { ChecklistItem, Note } from '@noted/shared-types';
import type { TranscriptSegment } from '@/lib/capture/captures-repo';

import { cleanSpeech } from '@/lib/structure/clean';
import { extractHighlights, type Highlight } from '@/lib/structure/extract';
import { formatOffset, groupIntoBlocks } from '@/lib/structure/segment';

/** How long a generated title may run before it is cut at a word boundary. */
const MAX_TITLE_CHARS = 60;

/** Section headings, so a caller can translate them without reaching into the text. */
export interface StructureLabels {
  summary: string;
  discussion: string;
  decisions: string;
  tasks: string;
  questions: string;
  transcript: string;
}

export const DEFAULT_LABELS: StructureLabels = {
  summary: 'Summary',
  discussion: 'Discussion',
  decisions: 'Decisions',
  tasks: 'Tasks',
  questions: 'Open questions',
  transcript: 'Transcript',
};

export interface StructuredNote {
  title: string;
  /** The note body, as Markdown. */
  markdown: string;
  /** Action items, ready to become the note's checklist. */
  checklist: ChecklistItem[];
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

function byKind(highlights: readonly Highlight[], kind: Highlight['kind']): Highlight[] {
  return highlights.filter((highlight) => highlight.kind === kind);
}

/**
 * Drop repeats.
 *
 * People restate a commitment several times in a meeting — when it is raised,
 * when it is agreed, and again in the wrap-up. Three identical tasks is a worse
 * note than one.
 */
function normaliseForComparison(text: string): string {
  return text.toLowerCase().replace(/[\s.,;:!?¿¡]+/g, ' ').trim();
}

function dedupe(highlights: readonly Highlight[]): Highlight[] {
  const seen = new Set<string>();
  const unique: Highlight[] = [];
  for (const highlight of highlights) {
    const key = normaliseForComparison(highlight.text);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(highlight);
  }
  return unique;
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
  const questions = byKind(highlights, 'question');

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
    ...renderSection(
      labels.transcript,
      blocks.map((block) => `**${formatOffset(block.startMs)}** ${block.text}`),
    ),
  ]
    .join('\n')
    .trim();

  return {
    // A title the user typed is theirs; only an untitled note gets one derived.
    title: existing?.title.trim() || deriveTitle(blocks, options.startedAt.toLocaleString()),
    markdown,
    checklist,
  };
}

/** The fields {@link structureTranscript} contributes to a note. */
export function toNotePatch(structured: StructuredNote): Partial<Note> {
  return {
    title: structured.title,
    body: structured.markdown,
    checklist: structured.checklist,
  };
}
