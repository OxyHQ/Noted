/**
 * Notes written before any of this existed.
 *
 * Every recorded note on a device today stores its generated half as one string
 * of Markdown, and nothing knows what is inside it — which points were which,
 * where they came from, or what the user has since edited. That information was
 * never captured, so a migration cannot invent it.
 *
 * What a migration CAN promise is that nobody loses a word. The old string
 * becomes a single opaque item, marked `legacy`, and the renderer emits it back
 * byte for byte. The note reads exactly as it did; it simply now arrives through
 * the same path as everything else, so one composer serves old notes and new ones
 * and there is no second rendering path to keep alive.
 *
 * Later passes replace a legacy artifact wholesale rather than editing it, which
 * is correct: the first time a recording is re-processed, real items with real
 * sources take over.
 */

import type { GeneratedNoteArtifact } from '@/lib/artifact/types';

/**
 * Ids derived from the note rather than minted.
 *
 * The migration has to be safe to run twice — a half-applied schema step, a
 * restored backup, a retry — and deterministic ids are what make the second run
 * write the same row instead of a second artifact holding the same text.
 */
export function legacyArtifactId(noteId: string): string {
  return `legacy-artifact:${noteId}`;
}

export function legacyItemId(noteId: string): string {
  return `legacy-item:${noteId}`;
}

export function legacySectionId(noteId: string): string {
  return `legacy-section:${noteId}`;
}

/**
 * Wrap an old `generated_body` as an artifact.
 *
 * @returns null when there was nothing generated — a note somebody typed by hand
 *   has no artifact, and writing an empty one would give every note in the
 *   database a row it does not need.
 */
export function legacyArtifact(input: {
  noteId: string;
  captureId: string;
  generatedBody: string;
  now: string;
}): GeneratedNoteArtifact | null {
  const text = input.generatedBody.trim();
  if (text === '') return null;

  return {
    id: legacyArtifactId(input.noteId),
    noteId: input.noteId,
    captureId: input.captureId,
    // `final` because nothing will ever refine it: the recording it came from
    // may not even have a transcript on this device any more. Marking it live
    // would invite a live pass to overwrite it.
    stage: 'final',
    profile: 'auto',
    intent: 'freeform',
    transcriptRevision: 0,
    artifactRevision: 0,
    sections: [
      {
        id: legacySectionId(input.noteId),
        kind: 'custom',
        items: [
          {
            id: legacyItemId(input.noteId),
            text,
            status: 'active',
            origin: 'legacy',
            // No sources, honestly: the old path never recorded which part of
            // the recording any of this came from. Claiming a range would be
            // inventing evidence.
            sources: [],
          },
        ],
      },
    ],
    checklists: [],
    openQuestions: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}
