/**
 * Small builders, so a test can say what it is about.
 *
 * An artifact has a dozen fields and a test that spells all of them out buries
 * the one line that matters. These fill in the boring parts and nothing else —
 * in particular they never default a `status` or an `origin`, because those are
 * exactly what most of these tests are checking.
 */

import type {
  GeneratedChecklist,
  GeneratedChecklistItem,
  GeneratedItem,
  GeneratedNoteArtifact,
  GeneratedSection,
  SourceRange,
} from '@/lib/artifact/types';

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

export function section(
  id: string,
  items: GeneratedItem[],
  over: Partial<GeneratedSection> = {},
): GeneratedSection {
  return { id, kind: 'notes', items, ...over };
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
