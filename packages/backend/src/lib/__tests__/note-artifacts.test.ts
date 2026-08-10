/**
 * What the server accepts as a note's generated half, and what it does with it.
 *
 * The artifact is the one thing a client uploads that the server cannot check
 * against anything: a body is text, a colour is an enum, and an artifact is a
 * nested document carrying provenance the server has no other copy of. So the
 * validator IS the contract, and a shape it lets through is a shape the app will
 * later have to render.
 *
 * No database here. The compare-and-swap is a `WHERE` clause and only a real
 * server can be asked whether it holds; what these cover is the validator, which
 * is pure, and the wiring, which is invisible to both.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { artifactWriteSchema, overrideWriteSchema } from '../note-artifacts.js';

const ROUTES = readFileSync(join(import.meta.dirname, '../../routes/notes.ts'), 'utf8');

/** A well-formed artifact, which every case below varies one field of. */
function artifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    noteId: 'n1',
    captureId: 'c1',
    stage: 'final',
    profile: 'event',
    intent: 'freeform',
    transcriptRevision: 4,
    artifactRevision: 1,
    sections: [
      {
        id: 's1',
        kind: 'notes',
        heading: 'Un tema',
        blocks: [
          {
            id: 'b1',
            kind: 'paragraph',
            text: 'Prosa.',
            status: 'active',
            origin: 'transcript',
            sources: [{ captureId: 'c1', startMs: 0, endMs: 1000, segmentIds: ['c1#0.0'] }],
          },
        ],
      },
    ],
    checklists: [],
    openQuestions: [],
    createdAt: '2026-08-09T18:00:00.000Z',
    updatedAt: '2026-08-09T18:05:00.000Z',
    ...over,
  };
}

describe('the validator', () => {
  it('accepts an artifact of the shape the app produces', () => {
    expect(artifactWriteSchema.safeParse(artifact()).success).toBe(true);
  });

  it('refuses a live artifact rather than ignoring it', () => {
    // A client uploading one is doing something wrong — it describes a recording
    // that has not finished. A 400 says so; a silently dropped field does not.
    expect(artifactWriteSchema.safeParse(artifact({ stage: 'live' })).success).toBe(false);
  });

  it('refuses a paragraph with no text', () => {
    // The reason blocks are a discriminated union and not one object with every
    // field optional: that shape accepts a paragraph with nothing in it, which
    // renders as a hole in the note with no error anywhere.
    const holed = artifact({
      sections: [
        {
          id: 's1',
          kind: 'notes',
          blocks: [{ id: 'b1', kind: 'paragraph', status: 'active', origin: 'transcript', sources: [] }],
        },
      ],
    });
    expect(artifactWriteSchema.safeParse(holed).success).toBe(false);
  });

  it('refuses a list with no lines field', () => {
    const holed = artifact({
      sections: [
        {
          id: 's1',
          kind: 'notes',
          blocks: [
            { id: 'b1', kind: 'bullet-list', status: 'active', origin: 'transcript', sources: [] },
          ],
        },
      ],
    });
    expect(artifactWriteSchema.safeParse(holed).success).toBe(false);
  });

  it('refuses a profile the app has no rendering for', () => {
    // The enum comes from the shared list, so this cannot drift from what the
    // client may produce.
    expect(artifactWriteSchema.safeParse(artifact({ profile: 'podcast' })).success).toBe(false);
  });

  it('refuses an origin nobody grants', () => {
    // `origin` is the trust model: it says whether a line came from the
    // recording or from the app's own knowledge. A value outside the four is a
    // claim about authorisation that nothing in the app can interpret.
    const forged = artifact({
      sections: [
        {
          id: 's1',
          kind: 'notes',
          blocks: [
            { id: 'b1', kind: 'paragraph', text: 'x', status: 'active', origin: 'trusted', sources: [] },
          ],
        },
      ],
    });
    expect(artifactWriteSchema.safeParse(forged).success).toBe(false);
  });

  it('keeps a negative revision out, since it would win every comparison', () => {
    expect(artifactWriteSchema.safeParse(artifact({ transcriptRevision: -1 })).success).toBe(false);
  });

  it('takes an override that only records a tick', () => {
    // `text: null` is the ordinary case — the user ticked something and wrote
    // nothing — so a schema requiring a string would refuse most real edits.
    const parsed = overrideWriteSchema.safeParse({
      itemId: 'i1',
      text: null,
      checked: true,
      removed: false,
      adopted: false,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('the routes', () => {
  it('write only the half the caller actually sent', () => {
    // A client PATCHing a colour sends neither field and must not thereby erase
    // a recording's structure.
    expect(ROUTES).toContain('if (input.artifacts) await upsertArtifacts');
    expect(ROUTES).toContain('if (input.itemOverrides) await upsertOverrides');
  });

  it('drop the generated half when a note is deleted forever', () => {
    // Deletion tombstones the note and clears its content; the row itself is
    // swept a month later. Leaving this behind would leave the
    // transcript-derived text of a deleted note in the database for that window.
    expect(ROUTES).toContain('await deleteGeneratedHalf(note.id, userId)');
  });

  it('return it from a sync and from a single-note read', () => {
    expect(ROUTES).toMatch(/readGeneratedHalf\(\s*present\.map/);
    expect(ROUTES).toContain('readGeneratedHalf([note.id], oxyUserId)');
  });

  it('do not pay for it on the feed', () => {
    // The list route shows title, body and colour on a card. Reading provenance
    // nothing displays would be a query per screen.
    const feed = ROUTES.slice(ROUTES.indexOf("router.get('/'"), ROUTES.indexOf("router.post('/'"));
    expect(feed).not.toContain('readGeneratedHalf');
  });

  it('pull a note whose generated half moved on its own', () => {
    // The sync cursor is the note's `updatedAt`, and an artifact can change
    // without it. Today the client writes the body at the same moment, which is
    // exactly why this must be checked rather than assumed.
    expect(ROUTES).toContain('notesWithGeneratedChangesSince(oxyUserId, since)');
  });
});
