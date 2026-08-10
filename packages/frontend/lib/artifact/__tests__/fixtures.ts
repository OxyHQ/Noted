/**
 * Small builders, so a test can say what it is about.
 *
 * An artifact has a dozen fields and a test that spells all of them out buries
 * the one line that matters. These fill in the boring parts and nothing else —
 * in particular they never default a `status` or an `origin`, because those are
 * exactly what most of these tests are checking.
 */

import type { GeneratedBlock, GeneratedChecklist, GeneratedChecklistItem, GeneratedItem, GeneratedNoteArtifact, GeneratedSection, SourceRange } from '@noted/shared-types';

export const CAPTURE_ID = 'cap_1';
export const NOTE_ID = 'note_1';
export const NOW = '2026-08-10T10:00:00.000Z';

export function source(startMs: number, endMs: number, ...segmentIds: string[]): SourceRange {
  return { captureId: CAPTURE_ID, startMs, endMs, segmentIds };
}

export function item(id: string, text: string, over: Partial<GeneratedItem> = {}): GeneratedItem {
  return {
    id,
    text,
    status: 'active',
    origin: 'transcript',
    sources: [source(0, 1000, `${id}-seg`)],
    ...over,
  };
}

export function checklistItem(
  id: string,
  text: string,
  over: Partial<GeneratedChecklistItem> = {},
): GeneratedChecklistItem {
  return { ...item(id, text), checked: false, ...over };
}

/**
 * A section holding one bullet list.
 *
 * Most of these tests are about what happens to ITEMS — statuses, overrides,
 * reconciliation — and a list is the shape that used to be the only one. Prose
 * has its own builder below, so a test about paragraphs says so.
 */
export function section(
  id: string,
  items: GeneratedItem[],
  over: Partial<GeneratedSection> = {},
): GeneratedSection {
  return {
    id,
    kind: 'notes',
    blocks:
      items.length > 0
        ? [
            {
              id: `${id}:list`,
              kind: 'bullet-list',
              status: 'active',
              origin: 'transcript',
              sources: [],
              items,
            },
          ]
        : [],
    ...over,
  };
}

/** A paragraph, as its own block. */
export function paragraph(id: string, text: string, over: Partial<GeneratedBlock> = {}): GeneratedBlock {
  return {
    id,
    kind: 'paragraph',
    text,
    status: 'active',
    origin: 'transcript',
    sources: [source(0, 1000, `${id}-seg`)],
    ...over,
  } as GeneratedBlock;
}

/** A section of prose. */
export function prose(id: string, blocks: GeneratedBlock[], over: Partial<GeneratedSection> = {}): GeneratedSection {
  return { id, kind: 'notes', blocks, ...over };
}

export function checklist(
  id: string,
  items: GeneratedChecklistItem[],
  over: Partial<GeneratedChecklist> = {},
): GeneratedChecklist {
  return { id, kind: 'actions', items, ...over };
}

export function artifact(over: Partial<GeneratedNoteArtifact> = {}): GeneratedNoteArtifact {
  return {
    id: 'art_1',
    noteId: NOTE_ID,
    captureId: CAPTURE_ID,
    stage: 'live',
    profile: 'auto',
    intent: 'freeform',
    transcriptRevision: 1,
    artifactRevision: 1,
    sections: [],
    checklists: [],
    openQuestions: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** The units inside a section, whatever blocks it is made of. */
export function unitsOf(section: GeneratedSection): GeneratedItem[] {
  return section.blocks.flatMap((block) =>
    block.kind === 'paragraph' || block.kind === 'quote' ? [block] : block.items,
  );
}
