/**
 * Notes written before the document model existed.
 *
 * A stored artifact holds `sections[].items` — an array of short lines — and the
 * domain now holds `sections[].blocks`. The migration happens at the repository
 * boundary, on read, and it has to be lossless.
 *
 * "Rebuildable" is not an answer here. An artifact CAN be regenerated from a
 * transcript, and for a capture whose audio and transcript have since been
 * deleted there is nothing left to regenerate from — that row IS the note.
 * Dropping it would be deleting somebody's note during an upgrade.
 */

import { describe, expect, it } from 'vitest';

import { allItems } from '@/lib/artifact/artifact';
import { renderArtifact } from '@/lib/artifact/render';
import type { GeneratedNoteArtifact } from '@noted/shared-types';
import { toBlockSection } from '@/lib/artifact/legacy-sections';

/**
 * A stored artifact as the previous version of this app wrote it, read back the
 * way the repository reads one.
 *
 * The repository itself reaches expo-sqlite and cannot be imported here, which
 * is exactly why the conversion lives in a module of its own.
 */
function readStored(document: { sections: unknown[] }): GeneratedNoteArtifact {
  return {
    id: 'artifact:cap_1:final',
    noteId: 'note_1',
    captureId: 'cap_1',
    stage: 'final',
    profile: 'auto',
    intent: 'freeform',
    transcriptRevision: 3,
    artifactRevision: 2,
    sections: document.sections.map(toBlockSection),
    checklists: [],
    openQuestions: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:05:00.000Z',
  };
}

const OLD_SECTION = {
  id: 'section:cap_1:notes',
  kind: 'notes',
  items: [
    {
      id: 'note:abc',
      text: 'PostgreSQL será la única base de datos',
      status: 'active',
      origin: 'transcript',
      sources: [{ captureId: 'cap_1', startMs: 0, endMs: 4_000, segmentIds: ['cap_1#0.0'] }],
    },
    {
      id: 'note:def',
      text: 'La migración terminó el viernes',
      status: 'active',
      origin: 'transcript',
      sources: [],
    },
  ],
};

describe('reading a note written before blocks existed', () => {
  const artifact = readStored({ sections: [OLD_SECTION] });

  it('keeps every line', () => {
    expect(allItems(artifact).map((unit) => unit.text)).toEqual([
      'PostgreSQL será la única base de datos',
      'La migración terminó el viernes',
    ]);
  });

  it('keeps the ids the user overrides point at', () => {
    // An override binds to an id. Renaming these during a migration would
    // silently detach every edit the user had made.
    expect(allItems(artifact).map((unit) => unit.id)).toEqual(['note:abc', 'note:def']);
  });

  it('keeps the evidence', () => {
    expect(allItems(artifact)[0].sources[0].segmentIds).toEqual(['cap_1#0.0']);
  });

  it('renders as the bullets it always was', () => {
    // The note reads exactly as it did. A migration that reflowed old notes into
    // paragraphs would be rewriting them, and nothing here knows enough to do
    // that safely.
    expect(renderArtifact(artifact)).toBe(
      '- PostgreSQL será la única base de datos\n- La migración terminó el viernes',
    );
  });

  it('marks the migrated block as legacy rather than claiming it was generated now', () => {
    expect(artifact.sections[0].blocks[0].origin).toBe('legacy');
  });
});

describe('edge cases that must not lose a note', () => {
  it('reads a section that had no items', () => {
    const artifact = readStored({ sections: [{ id: 's', kind: 'notes', items: [] }] });
    expect(artifact.sections[0].blocks).toEqual([]);
  });

  it('leaves a section already written as blocks alone', () => {
    // A row written by this version must not be migrated a second time.
    const modern = {
      id: 's',
      kind: 'notes',
      blocks: [
        {
          id: 'p1',
          kind: 'paragraph',
          text: 'Prosa.',
          status: 'active',
          origin: 'transcript',
          sources: [],
        },
      ],
    };
    const artifact = readStored({ sections: [modern] });
    expect(artifact.sections[0].blocks).toHaveLength(1);
    expect(artifact.sections[0].blocks[0].kind).toBe('paragraph');
    expect(renderArtifact(artifact)).toBe('Prosa.');
  });

  it('survives a row with neither shape', () => {
    const artifact = readStored({ sections: [{ id: 's', kind: 'notes' }] });
    expect(artifact.sections[0].blocks).toEqual([]);
    expect(renderArtifact(artifact)).toBe('');
  });
});
