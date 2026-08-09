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
  type GeneratedItem,
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
 * One item as a line.
 *
 * A legacy item is emitted exactly as it was stored, with no bullet added: its
 * text is a whole Markdown block from a note written before this domain existed,
 * and decorating it would rewrite somebody's old note during a migration.
 */
function renderItem(item: GeneratedItem): string {
  return item.origin === 'legacy' ? item.text.trim() : `- ${item.text.trim()}`;
}

function renderBlock(heading: string | null, items: readonly GeneratedItem[]): string[] {
  if (items.length === 0) return [];
  const lines = items.map(renderItem);
  return heading ? [`## ${heading}`, '', ...lines, ''] : [...lines, ''];
}

/**
 * The artifact as Markdown.
 *
 * Nothing here reads the user's note, and that is the point: this returns the
 * app's contribution alone, and `lib/artifact/compose.ts` is the only thing that
 * puts the two together.
 */
export function renderArtifact(
  artifact: GeneratedNoteArtifact,
  labels: ArtifactLabels = DEFAULT_ARTIFACT_LABELS,
): string {
  const sections = nonEmptySections(artifact).flatMap((section) =>
    renderBlock(headingFor(section, labels), section.items),
  );

  // Only when there is genuinely something unresolved. A "Open questions: none"
  // heading reads as a finding about the meeting; its absence reads as what it is.
  const questions = renderBlock(labels.questions, visibleItems(artifact.openQuestions));

  return [...sections, ...questions].join('\n').trim();
}
