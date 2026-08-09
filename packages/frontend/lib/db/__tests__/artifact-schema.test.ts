/**
 * The migration that introduces the artifact domain, checked against the domain.
 *
 * Two facts in this repository are written twice and have to agree, and neither
 * `tsc` nor a running app can notice when they stop:
 *
 * - The backfill that splits the old `state` column into three, and
 *   `lifecycleFromLegacyState`, which does the same split in TypeScript. A drift
 *   here mislabels every capture that already exists on a device — silently,
 *   because a wrong-but-valid state renders perfectly well.
 * - The order of the transcript-segment statements. Existing rows all share a
 *   logical key of (0, 0) until they are given one, so creating the unique index
 *   before the backfill fails the migration and strands every device that already
 *   has a transcript. The statements read fine in either order.
 */

import { describe, expect, it } from 'vitest';

import { LOCAL_TABLES, MIGRATIONS } from '@/lib/db/migrations';
import { lifecycleFromLegacyState, type LegacyCaptureState } from '@/lib/capture/lifecycle';

/** The migration under test: the one this file was added alongside. */
const ARTIFACT_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1];

const LEGACY_STATES: readonly LegacyCaptureState[] = [
  'recording',
  'interrupted',
  'transcribing',
  'complete',
  'failed',
];

function value(statement: string, column: string): string | null {
  return new RegExp(`${column}\\s*=\\s*'([a-z]+)'`).exec(statement)?.[1] ?? null;
}

function backfillFor(state: LegacyCaptureState): string | undefined {
  return ARTIFACT_MIGRATION.find(
    (statement) =>
      statement.startsWith('UPDATE captures') && statement.includes(`WHERE state = '${state}'`),
  );
}

function indexOfStatement(needle: string): number {
  return ARTIFACT_MIGRATION.findIndex((statement) => statement.includes(needle));
}

describe('the artifact migration', () => {
  it('is the migration this file thinks it is', () => {
    // Without this the assertions below would pass by finding nothing the day
    // somebody appends another migration.
    expect(ARTIFACT_MIGRATION.some((statement) => statement.includes('note_artifacts'))).toBe(true);
    expect(ARTIFACT_MIGRATION.length).toBeGreaterThan(15);
  });

  it('declares every table it creates', () => {
    // `LOCAL_TABLES` is what wipes an account's data on sign-out and what the
    // SQL-reference gate checks against; a table missing from it survives a
    // sign-out with the previous user's notes in it.
    expect(LOCAL_TABLES).toContain('note_artifacts');
    expect(LOCAL_TABLES).toContain('note_item_overrides');
  });
});

describe('the lifecycle backfill', () => {
  it('covers every state a stored row can hold', () => {
    for (const state of LEGACY_STATES) {
      expect(backfillFor(state), `no backfill for state ${state}`).toBeDefined();
    }
  });

  it('splits each state exactly the way the domain does', () => {
    for (const state of LEGACY_STATES) {
      const statement = backfillFor(state);
      expect(statement).toBeDefined();
      if (!statement) continue;

      const expected = lifecycleFromLegacyState(state);
      expect(
        {
          capture: value(statement, 'capture_status'),
          transcription: value(statement, 'transcription_status'),
          generation: value(statement, 'generation_status'),
        },
        `backfill for ${state} disagrees with lifecycleFromLegacyState`,
      ).toEqual(expected);
    }
  });

  it('reads a real value out of the SQL, not null from a broken pattern', () => {
    // The extraction above returns null for anything it cannot parse, and three
    // nulls compared against three nulls would pass. Pinned against a statement
    // whose answer is known.
    expect(value("UPDATE captures SET capture_status = 'failed' WHERE x", 'capture_status')).toBe(
      'failed',
    );
    expect(value('UPDATE captures SET capture_status = x WHERE y', 'capture_status')).toBeNull();
  });
});

describe('transcript segment identity', () => {
  it('gives existing rows a distinct key before demanding one', () => {
    const backfill = indexOfStatement('SET segment_index = rowid');
    const index = indexOfStatement('transcript_segments_logical');
    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeLessThan(index);
  });

  it('adds the columns the key is made of before filling them', () => {
    const column = indexOfStatement('ADD COLUMN segment_index');
    expect(column).toBeGreaterThanOrEqual(0);
    expect(column).toBeLessThan(indexOfStatement('SET segment_index = rowid'));
  });
});
