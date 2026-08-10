/**
 * That a recording survives the trip to another device.
 *
 * Until now the artifact was device-local: the note's Markdown reached the
 * server and everything behind it — which sentence came from which second, who
 * was speaking, which lines the user rewrote — stayed on the phone that made the
 * recording. Open the same note on a laptop and it was text that had forgotten
 * where it came from.
 *
 * These cover the two halves of that: what a push sends, and what a pull is
 * allowed to overwrite. The revision guard itself is SQL and is covered by
 * `artifact-schema.test.ts`; what is checked here is that sync uses it rather
 * than a second spelling of it.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GeneratedNoteArtifact } from '@noted/shared-types';

// The repo reaches SQLite for its queries and the store's change signal for its
// React bindings. Neither is used below: `artifactUpsertStatement` and
// `rowToArtifact` are pure, which is what makes a real round trip testable here.
vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  isDbAvailable: () => true,
  subscribe: () => () => undefined,
}));

const { artifactUpsertStatement, rowToArtifact } = await import('@/lib/db/artifacts-repo');

const read = (path: string): string =>
  readFileSync(join(import.meta.dirname, '..', path), 'utf8');

const SYNC = read('sync.ts');
const REPO = read('artifacts-repo.ts');

describe('what a push sends', () => {
  it('carries the generated half with the note, not on a route of its own', () => {
    // One request. A second endpoint would let a note and its evidence arrive
    // out of order, and there is no ordering rule that makes that safe.
    expect(SYNC).toContain('notePayloadWithGenerated');
    expect(SYNC).toContain('listFinalArtifacts');
    expect(SYNC).toContain('getNoteOverrides');
  });

  it('sends every settled artifact, not just the newest', () => {
    // A note somebody recorded into twice holds two final artifacts. Sending
    // only the newer one tells the server the first recording never happened.
    expect(REPO).toContain('export async function listFinalArtifacts');
    expect(REPO).toMatch(/listFinalArtifacts[\s\S]*?artifact\.stage === 'final'/);
  });

  it('sends no live artifact', () => {
    // It is replaced wholesale every few seconds and describes a recording that
    // has not finished. Uploading it would be a request per slice.
    expect(SYNC).not.toContain('getNoteArtifacts');
  });
});

describe('what a pull may overwrite', () => {
  it('applies an arriving artifact through the same guarded upsert a local pass uses', () => {
    // The guard is the `WHERE` clause on that statement. A sync path with its
    // own upsert would be a second rule, and the one that let a stale device win.
    expect(SYNC).toContain('artifactUpsertStatement');
    expect(REPO).toContain('WHERE excluded.transcript_revision >= note_artifacts.transcript_revision');
  });

  it('is not vacuous — the guard is what that statement is for', () => {
    // If `artifactUpsertStatement` stopped carrying the guard, the assertion
    // above would still pass on the name alone.
    expect(REPO).toMatch(/ARTIFACT_UPSERT_SQL[\s\S]*?WHERE excluded\.transcript_revision/);
    expect(REPO).toMatch(/function artifactUpsertStatement[\s\S]*?sql: ARTIFACT_UPSERT_SQL/);
  });

  it('leaves the local artifact alone when the server said nothing about it', () => {
    // The feed read does not carry the generated half. An absent field means
    // "no opinion"; an empty array would mean "there are none" and wipe it.
    expect(SYNC).toContain('note.artifacts ?? []');
    expect(SYNC).toContain('note.itemOverrides ?? []');
  });

  it('applies it in the same transaction as the note it arrived with', () => {
    // Otherwise a failure between the two leaves a note whose body claims a
    // structure the device does not have.
    expect(SYNC).toContain(
      'statements.push(...applyServerNoteStatements(note), ...generatedHalfStatements(note, now));',
    );
  });
});

describe('who was speaking survives being written down', () => {
  /**
   * An artifact through the write and back out of the read.
   *
   * The statement's parameters ARE the row, so this is the real round trip and
   * not a re-implementation of it: whatever the upsert does not put in
   * `doc_json` is what a reload cannot return.
   */
  function roundTrip(artifact: GeneratedNoteArtifact): GeneratedNoteArtifact {
    const params = artifactUpsertStatement(artifact).params as unknown[];
    return rowToArtifact({
      id: String(params[0]),
      note_id: String(params[1]),
      capture_id: String(params[2]),
      stage: String(params[3]),
      profile: String(params[4]),
      intent: String(params[5]),
      transcript_revision: Number(params[6]),
      artifact_revision: Number(params[7]),
      doc_json: String(params[8]),
      created_at: String(params[9]),
      updated_at: String(params[10]),
    });
  }

  const artifact: GeneratedNoteArtifact = {
    id: 'a1',
    noteId: 'n1',
    captureId: 'c1',
    stage: 'final',
    profile: 'event',
    intent: 'freeform',
    transcriptRevision: 4,
    artifactRevision: 1,
    sections: [],
    checklists: [],
    openQuestions: [],
    people: [
      {
        id: 'p1',
        role: 'Education minister',
        sources: [{ captureId: 'c1', startMs: 0, endMs: 5_000, segmentIds: ['c1#0.0'] }],
      },
    ],
    createdAt: '2026-08-09T18:00:00.000Z',
    updatedAt: '2026-08-09T18:05:00.000Z',
  };

  it('comes back out of the row it was written into', () => {
    // It did not. `people` was added to the artifact and never added to the
    // document that gets persisted, so the speaker rendered once and vanished
    // the moment the note was reloaded — the attribution #59 asked for, lost at
    // the one point nothing was looking.
    expect(roundTrip(artifact).people).toEqual(artifact.people);
  });

  it('keeps the evidence for it, not just the label', () => {
    // A role with no sources is a claim about a person that nothing supports,
    // which is the failure the whole `sources` field exists to make visible.
    expect(roundTrip(artifact).people?.[0].sources[0].segmentIds).toEqual(['c1#0.0']);
  });

  it('stays absent when the recording never said', () => {
    // The absence of a speaker is information. An empty array would render as a
    // speaker line with nothing after it.
    expect(roundTrip({ ...artifact, people: undefined }).people).toBeUndefined();
  });

  it('carries the rest of the document with it', () => {
    // A round trip that returned only `people` would pass the three above.
    const full = roundTrip({
      ...artifact,
      title: { id: 't', text: 'Una charla', status: 'active', origin: 'transcript', sources: [] },
      openQuestions: [
        { id: 'q1', text: '¿Y esto?', status: 'active', origin: 'transcript', sources: [] },
      ],
    });
    expect(full.title?.text).toBe('Una charla');
    expect(full.openQuestions[0].text).toBe('¿Y esto?');
    expect(full.transcriptRevision).toBe(4);
  });
});
