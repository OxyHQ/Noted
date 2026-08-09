/**
 * Generated artifacts and the user's edits to them, in the local store.
 *
 * The revision guard lives here rather than in the caller, and that placement is
 * the point: a write is refused by the database, in the same statement that would
 * have performed it, so a task that has been asleep for ten seconds cannot beat a
 * fresher one by winning a race between a read and a write.
 *
 * Two guards, because they catch different things:
 *
 * - **Revision.** An artifact may only be replaced by one built from a transcript
 *   at least as new. This is the compare-and-swap, and it is a `WHERE` clause on
 *   the upsert.
 * - **Stage.** A live pass may never land once the final artifact exists, at any
 *   revision. Finalisation has read the whole recording; a live pass never has.
 */

import { execute, executeTransaction, type Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';
import type { ArtifactStage, GeneratedNoteArtifact } from '@/lib/artifact/types';
import { emptyOverride, type UserItemOverride } from '@/lib/artifact/ownership';

export interface ArtifactRow extends Row {
  id: string;
  note_id: string;
  capture_id: string;
  stage: string;
  profile: string;
  intent: string;
  transcript_revision: number;
  artifact_revision: number;
  doc_json: string;
  created_at: string;
  updated_at: string;
}

/** The parts of an artifact that live inside `doc_json` rather than in a column. */
type ArtifactDocument = Pick<
  GeneratedNoteArtifact,
  'title' | 'sections' | 'checklists' | 'openQuestions'
>;

const EMPTY_DOCUMENT: ArtifactDocument = { sections: [], checklists: [], openQuestions: [] };

/**
 * Sections and checklists are stored as JSON, and the columns beside them are the
 * ones anything ever queries BY.
 *
 * A full relational shredding — a row per item, a row per source range — would
 * buy the ability to query for "every item derived from an instruction", which
 * nothing wants, and cost a join per render of every note. The revision and the
 * stage are columns precisely because the guards above are expressed in SQL.
 */
function parseDocument(json: string): ArtifactDocument {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_DOCUMENT;
    const document = parsed as Partial<ArtifactDocument>;
    return {
      title: document.title,
      sections: Array.isArray(document.sections) ? document.sections : [],
      checklists: Array.isArray(document.checklists) ? document.checklists : [],
      openQuestions: Array.isArray(document.openQuestions) ? document.openQuestions : [],
    };
  } catch {
    // A corrupt row renders as an artifact with nothing in it rather than taking
    // the note down with it. The next generation pass overwrites it.
    return EMPTY_DOCUMENT;
  }
}

export function rowToArtifact(row: ArtifactRow): GeneratedNoteArtifact {
  const document = parseDocument(row.doc_json);
  return {
    id: row.id,
    noteId: row.note_id,
    captureId: row.capture_id,
    stage: row.stage === 'final' ? 'final' : 'live',
    profile: row.profile as GeneratedNoteArtifact['profile'],
    intent: row.intent as GeneratedNoteArtifact['intent'],
    transcriptRevision: row.transcript_revision,
    artifactRevision: row.artifact_revision,
    title: document.title,
    sections: document.sections,
    checklists: document.checklists,
    openQuestions: document.openQuestions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowsToArtifacts(rows: readonly ArtifactRow[]): GeneratedNoteArtifact[] {
  return rows.map(rowToArtifact);
}

/** The live and final artifacts of a note, whichever exist. */
export interface NoteArtifacts {
  live: GeneratedNoteArtifact | null;
  final: GeneratedNoteArtifact | null;
}

/**
 * Sort the artifacts of one note into the two slots a composer reads.
 *
 * A note can hold artifacts from several captures — somebody recorded twice into
 * the same note — and the newest of each stage is the one that describes the note
 * as it stands.
 */
export function toNoteArtifacts(artifacts: readonly GeneratedNoteArtifact[]): NoteArtifacts {
  const newest = (stage: ArtifactStage): GeneratedNoteArtifact | null =>
    artifacts
      .filter((artifact) => artifact.stage === stage)
      .reduce<GeneratedNoteArtifact | null>(
        (best, artifact) => (best === null || artifact.updatedAt > best.updatedAt ? artifact : best),
        null,
      );
  return { live: newest('live'), final: newest('final') };
}

const ARTIFACT_COLUMNS = `id, note_id, capture_id, stage, profile, intent,
  transcript_revision, artifact_revision, doc_json, created_at, updated_at`;

const ARTIFACTS_BY_NOTE_SQL = `SELECT ${ARTIFACT_COLUMNS} FROM note_artifacts
  WHERE note_id = ? ORDER BY updated_at ASC`;

const ARTIFACTS_BY_CAPTURE_SQL = `SELECT ${ARTIFACT_COLUMNS} FROM note_artifacts
  WHERE capture_id = ? ORDER BY updated_at ASC`;

export async function getNoteArtifacts(noteId: string): Promise<NoteArtifacts> {
  return toNoteArtifacts(rowsToArtifacts(await execute<ArtifactRow>(ARTIFACTS_BY_NOTE_SQL, [noteId])));
}

export async function getCaptureArtifacts(captureId: string): Promise<NoteArtifacts> {
  return toNoteArtifacts(
    rowsToArtifacts(await execute<ArtifactRow>(ARTIFACTS_BY_CAPTURE_SQL, [captureId])),
  );
}

/**
 * The upsert, with the revision guard as a `WHERE` on the conflict branch.
 *
 * `transcript_revision >= existing` rather than `>`: a pass may legitimately
 * rewrite the artifact for the SAME transcript — the model finishing after the
 * deterministic floor already wrote one is exactly that — while an older
 * transcript is refused.
 */
const ARTIFACT_UPSERT_SQL = `
INSERT INTO note_artifacts (
  id, note_id, capture_id, stage, profile, intent,
  transcript_revision, artifact_revision, doc_json, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (note_id, capture_id, stage) DO UPDATE SET
  id = excluded.id,
  profile = excluded.profile,
  intent = excluded.intent,
  transcript_revision = excluded.transcript_revision,
  artifact_revision = excluded.artifact_revision,
  doc_json = excluded.doc_json,
  updated_at = excluded.updated_at
WHERE excluded.transcript_revision >= note_artifacts.transcript_revision
`;

const FINAL_EXISTS_SQL = `SELECT id FROM note_artifacts
  WHERE note_id = ? AND capture_id = ? AND stage = 'final' LIMIT 1`;

/**
 * Persist an artifact, unless something newer already sits in its slot.
 *
 * @returns whether the write landed. `false` is an ordinary outcome — it means a
 *   newer revision or the final artifact won — and callers log it rather than
 *   retrying, because retrying is how a stale task eventually succeeds.
 */
export async function saveArtifact(artifact: GeneratedNoteArtifact): Promise<boolean> {
  if (artifact.stage === 'live') {
    const finalRows = await execute<Row>(FINAL_EXISTS_SQL, [artifact.noteId, artifact.captureId]);
    if (finalRows.length > 0) return false;
  }

  const document: ArtifactDocument = {
    title: artifact.title,
    sections: artifact.sections,
    checklists: artifact.checklists,
    openQuestions: artifact.openQuestions,
  };

  const affected = await executeTransaction([
    {
      sql: ARTIFACT_UPSERT_SQL,
      params: [
        artifact.id,
        artifact.noteId,
        artifact.captureId,
        artifact.stage,
        artifact.profile,
        artifact.intent,
        artifact.transcriptRevision,
        artifact.artifactRevision,
        JSON.stringify(document),
        artifact.createdAt,
        artifact.updatedAt,
      ],
    },
  ]);
  return (affected[0] ?? 0) > 0;
}

/** Forget a capture's artifacts — when its recording and notes are deleted together. */
export function deleteCaptureArtifacts(captureId: string): Promise<number[]> {
  return executeTransaction([
    { sql: 'DELETE FROM note_artifacts WHERE capture_id = ?', params: [captureId] },
  ]);
}

/* ── What the user did to generated items ──────────────────────── */

export interface OverrideRow extends Row {
  note_id: string;
  item_id: string;
  text: string | null;
  checked: number | null;
  removed: number;
  adopted: number;
}

export function rowsToOverrides(rows: readonly OverrideRow[]): UserItemOverride[] {
  return rows.map((row) => ({
    itemId: row.item_id,
    text: row.text,
    // Three states, not two: null means the user never said, which is what lets a
    // regenerated artifact set the tick itself without undoing a real decision.
    checked: row.checked === null ? null : row.checked === 1,
    removed: row.removed === 1,
    adopted: row.adopted === 1,
  }));
}

const OVERRIDES_BY_NOTE_SQL = `SELECT note_id, item_id, text, checked, removed, adopted
  FROM note_item_overrides WHERE note_id = ?`;

export async function getNoteOverrides(noteId: string): Promise<UserItemOverride[]> {
  return rowsToOverrides(await execute<OverrideRow>(OVERRIDES_BY_NOTE_SQL, [noteId]));
}

/**
 * Record one user decision about one generated item.
 *
 * Merged into whatever is already stored rather than replacing it: ticking an
 * item the user had already reworded must not throw the wording away, and the two
 * arrive as separate calls.
 */
export async function setNoteOverride(
  noteId: string,
  patch: Partial<UserItemOverride> & { itemId: string },
): Promise<void> {
  const stored = await execute<OverrideRow>(
    `SELECT note_id, item_id, text, checked, removed, adopted
     FROM note_item_overrides WHERE note_id = ? AND item_id = ?`,
    [noteId, patch.itemId],
  );
  const current = rowsToOverrides(stored)[0] ?? emptyOverride(patch.itemId);
  const next: UserItemOverride = { ...current, ...patch };

  await executeTransaction([
    {
      sql: `INSERT INTO note_item_overrides (note_id, item_id, text, checked, removed, adopted, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (note_id, item_id) DO UPDATE SET
              text = excluded.text,
              checked = excluded.checked,
              removed = excluded.removed,
              adopted = excluded.adopted,
              updated_at = excluded.updated_at`,
      params: [
        noteId,
        next.itemId,
        next.text,
        next.checked === null ? null : next.checked ? 1 : 0,
        next.removed ? 1 : 0,
        next.adopted ? 1 : 0,
        new Date().toISOString(),
      ],
    },
  ]);
}

/* ── React bindings ────────────────────────────────────────────── */

// Module scope, because `useLiveQuery` re-maps whenever this identity changes and
// an inline arrow is a new identity on every render.
function mapArtifactRows(rows: readonly ArtifactRow[]): NoteArtifacts {
  return toNoteArtifacts(rowsToArtifacts(rows));
}

/** A note's artifacts, updating as generation lands. */
export function useNoteArtifacts(noteId: string | undefined): {
  data: NoteArtifacts;
  isLoading: boolean;
} {
  const { data, isLoading } = useLiveQuery<ArtifactRow, NoteArtifacts>({
    sql: ARTIFACTS_BY_NOTE_SQL,
    params: [noteId ?? ''],
    mapRows: mapArtifactRows,
  });
  return { data, isLoading };
}

/** A note's user overrides, updating as the user edits generated items. */
export function useNoteOverrides(noteId: string | undefined): {
  data: UserItemOverride[];
  isLoading: boolean;
} {
  const { data, isLoading } = useLiveQuery<OverrideRow, UserItemOverride[]>({
    sql: OVERRIDES_BY_NOTE_SQL,
    params: [noteId ?? ''],
    mapRows: rowsToOverrides,
  });
  return { data, isLoading };
}
