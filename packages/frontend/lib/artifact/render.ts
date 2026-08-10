/**
 * The one place an artifact becomes text.
 *
 * Every generator, every surface: the card, the open editor, the Markdown export
 * and whatever syncs to another device all read this function. That is the only
 * way the card and the editor can be guaranteed to agree — they agree because
 * there is nothing for them to disagree about.
 *
 * What it deliberately does NOT render is the checklist. A task written into the
 * body as well as into the checklist is two copies of the same task, and they
 * disagree the moment one of them is ticked.
 */

import {
  DEFAULT_ARTIFACT_LABELS,
  type ArtifactLabels,
  type GeneratedBlock,
  type GeneratedNoteArtifact,
  type GeneratedSection,
} from '@/lib/artifact/types';
import { nonEmptySections, visibleItems } from '@/lib/artifact/artifact';

/**
 * A section's heading, when it has earned one.
 *
 * `notes` gets none on purpose: those items ARE the note, and "## Summary" above
 * the only content on the page is a label for something that needs no labelling.
 * An explicit `heading` from a profile wins over all of this.
 */
export function headingFor(section: GeneratedSection, labels: ArtifactLabels): string | null {
  if (section.heading !== undefined) return section.heading.trim() || null;
  switch (section.kind) {
    case 'notes':
      return null;
    case 'concepts':
      return labels.concepts;
    case 'examples':
      return labels.examples;
    case 'ideas':
      return labels.ideas;
    case 'decisions':
      return labels.decisions;
    case 'takeaways':
      return labels.takeaways;
    case 'custom':
      return null;
  }
}

/**
 * One block as Markdown.
 *
 * A paragraph is a paragraph. That sentence is the entire point of this file
 * changing: the old renderer prefixed every item with `- `, so connected
 * reasoning came out as a list of peers no matter what the generator understood,
 * and no prompt could defeat a dash added after the fact.
 *
 * A legacy block is emitted exactly as it was stored, with nothing added: its
 * text is a whole Markdown block from a note written before this domain existed,
 * and decorating it would rewrite somebody's old note during a migration.
 */
function renderBlock(block: GeneratedBlock): string[] {
  if (block.kind === 'paragraph') {
    return block.origin === 'legacy' ? [block.text.trim()] : [block.text.trim()];
  }
  if (block.kind === 'quote') {
    const lines = block.text
      .trim()
      .split('\n')
      .map((line) => `> ${line}`);
    // The attribution belongs to the quotation, so it stays inside it — a line
    // after the block reads as the note speaking, which is the one thing a quote
    // exists to avoid.
    return block.attribution ? [...lines, `>`, `> — ${block.attribution}`] : lines;
  }
  if (block.kind === 'numbered-list') {
    return block.items.map((item, index) => `${String(index + 1)}. ${item.text.trim()}`);
  }
  return block.items.map((item) => `- ${item.text.trim()}`);
}

/**
 * The artifact as Markdown.
 *
 * Nothing here reads the user's note, and that is the point: this returns the
 * app's contribution alone, and `lib/artifact/compose.ts` is the only thing that
 * puts the two together.
 */
/**
 * Who the recording is about, when it says.
 *
 * First, because a note about a talk is unreadable until you know whose talk it
 * was — and because the absence of a name is itself information the reader
 * deserves rather than a gap they have to notice.
 */
function renderPeople(artifact: GeneratedNoteArtifact, labels: ArtifactLabels): string[] {
  const people = (artifact.people ?? []).filter(
    (person) => person.name ?? person.role ?? person.organization,
  );
  if (people.length === 0) return [];

  return [
    ...people.map((person) => {
      const described = [person.name, person.role, person.organization]
        .filter((part): part is string => (part ?? '').trim() !== '')
        .join(' — ');
      return `**${labels.speaker}:** ${described}`;
    }),
    '',
  ];
}

export function renderArtifact(
  artifact: GeneratedNoteArtifact,
  labels: ArtifactLabels = DEFAULT_ARTIFACT_LABELS,
): string {
  const people = renderPeople(artifact, labels);

  const sections = nonEmptySections(artifact).flatMap((section) => {
    const heading = headingFor(section, labels);
    // A blank line between blocks, so two paragraphs stay two paragraphs and a
    // list does not weld itself to the sentence above it.
    const body = section.blocks.flatMap((block, index) =>
      index === 0 ? renderBlock(block) : ['', ...renderBlock(block)],
    );
    return heading ? [`## ${heading}`, '', ...body, ''] : [...body, ''];
  });

  // Only when there is genuinely something unresolved. An "Open questions: none"
  // heading reads as a finding about the meeting; its absence reads as what it is.
  const open = visibleItems(artifact.openQuestions);
  const questions =
    open.length > 0
      ? [`## ${labels.questions}`, '', ...open.map((item) => `- ${item.text.trim()}`), '']
      : [];

  return [...people, ...sections, ...questions].join('\n').trim();
}
