/**
 * Recordings in the local store.
 *
 * A capture is a recording session: the audio file on disk, how far transcription
 * got, and how far the note got. It is written before the microphone opens and
 * updated as it progresses, so a capture that outlives its process leaves enough
 * behind to be recovered rather than silently lost — which is the whole point of
 * writing the row first.
 *
 * ## Three statuses, and the one that is still here for compatibility
 *
 * The microphone, the transcript and the note finish at different moments, so
 * each has its own column (see `lib/capture/lifecycle.ts`). The old single
 * `state` column is still maintained beside them, derived on every write, so a
 * build that has not migrated can still read a row this one wrote. It is written,
 * never read, by anything here.
 */

import { execute, executeTransaction, type Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';
import {
  legacyStateFromLifecycle,
  lifecycleFromLegacyState,
  type CaptureLifecycle,
  type CaptureStatus,
  type LegacyCaptureState,
  type EnhancementStatus,
  type NoteGenerationStatus,
  type TranscriptionStatus,
} from '@/lib/capture/lifecycle';
import type { CaptureProfile } from '@/lib/artifact/types';
import { deleteCaptureAudio } from '@/lib/audio/store';
import { segmentId } from '@/lib/stt/segment-id';

export interface CaptureRow extends Row {
  id: string;
  note_id: string;
  state: string;
  capture_status: string;
  transcription_status: string;
  generation_status: string;
  enhancement_status: string;
  profile: string;
  transcript_revision: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  audio_path: string;
  language: string | null;
  error_code: string | null;
}

export interface Capture {
  id: string;
  noteId: string;
  lifecycle: CaptureLifecycle;
  profile: CaptureProfile;
  transcriptRevision: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  audioPath: string;
  errorCode: string | null;
}

const CAPTURE_STATUSES: readonly string[] = [
  'starting',
  'recording',
  'stopping',
  'stopped',
  'interrupted',
  'failed',
];
const TRANSCRIPTION_STATUSES: readonly string[] = [
  'idle',
  'live',
  'pending',
  'running',
  'complete',
  'failed',
];
const GENERATION_STATUSES: readonly string[] = ['idle', 'live', 'finalizing', 'complete', 'failed'];
const ENHANCEMENT_STATUSES: readonly string[] = [
  'unsupported',
  'pending',
  'running',
  'complete',
  'failed',
];
const LEGACY_STATES: readonly string[] = [
  'recording',
  'interrupted',
  'transcribing',
  'complete',
  'failed',
];

/**
 * Read the three statuses, falling back to the old column when they are blank.
 *
 * A row written by a build before the split has empty status columns and a
 * meaningful `state`; deriving from `state` is what lets that row be understood
 * rather than treated as corrupt. An UNRECOGNISED value in either place is read
 * as failed: a row nothing will ever move should look inert, not active.
 */
export function rowToLifecycle(row: CaptureRow): CaptureLifecycle {
  const known =
    CAPTURE_STATUSES.includes(row.capture_status) &&
    TRANSCRIPTION_STATUSES.includes(row.transcription_status) &&
    GENERATION_STATUSES.includes(row.generation_status);
  if (known) {
    return {
      capture: row.capture_status as CaptureStatus,
      transcription: row.transcription_status as TranscriptionStatus,
      generation: row.generation_status as NoteGenerationStatus,
      // A row written before enhancement had a column of its own reads as
      // `pending`, which is what it was: nothing had tried yet.
      enhancement: ENHANCEMENT_STATUSES.includes(row.enhancement_status)
        ? (row.enhancement_status as EnhancementStatus)
        : 'pending',
    };
  }
  const legacy = LEGACY_STATES.includes(row.state) ? (row.state as LegacyCaptureState) : 'failed';
  return lifecycleFromLegacyState(legacy);
}

function toProfile(value: string): CaptureProfile {
  const profiles: readonly string[] = [
    'auto',
    'meeting',
    'lecture',
    'event',
    'brainstorm',
    'interview',
    'dictation',
  ];
  return (profiles.includes(value) ? value : 'auto') as CaptureProfile;
}

function rowToCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    noteId: row.note_id,
    lifecycle: rowToLifecycle(row),
    profile: toProfile(row.profile),
    transcriptRevision: row.transcript_revision,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    audioPath: row.audio_path,
    errorCode: row.error_code,
  };
}

export function rowsToCaptures(rows: readonly CaptureRow[]): Capture[] {
  return rows.map(rowToCapture);
}

function firstRowToCapture(rows: readonly CaptureRow[]): Capture | null {
  const row = rows[0];
  return row ? rowToCapture(row) : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ── Writes ────────────────────────────────────────────────────── */

/**
 * Record that a capture is about to start.
 *
 * Written BEFORE the microphone opens. If the app dies a second later, this row
 * is the only evidence the recording ever existed, and the audio file it names is
 * what recovery transcribes.
 */
export async function beginCapture(input: {
  id: string;
  noteId: string;
  audioPath: string;
  language?: string;
  profile?: CaptureProfile;
}): Promise<void> {
  const now = nowIso();
  const lifecycle: CaptureLifecycle = {
    capture: 'starting',
    transcription: 'idle',
    generation: 'idle',
    enhancement: 'pending',
  };
  await executeTransaction([
    {
      sql: `INSERT INTO captures (
              id, note_id, state, capture_status, transcription_status, generation_status,
              enhancement_status, profile, transcript_revision, started_at, ended_at, duration_ms,
              audio_path, audio_file_id, model_id, language, error_code, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, 0, ?, NULL, NULL, ?, NULL, ?, ?)`,
      params: [
        input.id,
        input.noteId,
        legacyStateFromLifecycle(lifecycle),
        lifecycle.capture,
        lifecycle.transcription,
        lifecycle.generation,
        lifecycle.enhancement,
        input.profile ?? 'auto',
        now,
        input.audioPath,
        input.language ?? null,
        now,
        now,
      ],
    },
  ]);
}

/**
 * Move one or more of a capture's statuses.
 *
 * The row is read first so the legacy `state` can be derived from the WHOLE
 * lifecycle rather than from the one status being changed — a patch that only
 * touches generation still has to leave `state` describing the capture as a
 * whole, or an older build reads a finished recording as one still going.
 */
export async function setCaptureLifecycle(
  id: string,
  patch: Partial<CaptureLifecycle> & { errorCode?: string | null; profile?: CaptureProfile },
): Promise<CaptureLifecycle | null> {
  const current = await getCapture(id);
  if (!current) return null;

  const lifecycle: CaptureLifecycle = { ...current.lifecycle, ...patch };
  const now = nowIso();
  await executeTransaction([
    {
      sql: `UPDATE captures SET state = ?, capture_status = ?, transcription_status = ?,
              generation_status = ?, enhancement_status = ?, profile = ?, error_code = ?,
              updated_at = ?
            WHERE id = ?`,
      params: [
        legacyStateFromLifecycle(lifecycle),
        lifecycle.capture,
        lifecycle.transcription,
        lifecycle.generation,
        lifecycle.enhancement,
        patch.profile ?? current.profile,
        patch.errorCode === undefined ? current.errorCode : patch.errorCode,
        now,
        id,
      ],
    },
  ]);
  return lifecycle;
}

/**
 * Record that the microphone closed cleanly, how long it ran, and where the audio
 * ended up.
 *
 * Deliberately says nothing about the transcript or the note. Stopping the
 * microphone and finishing the note are different operations, and conflating them
 * is what made the stop button appear to hang while a model loaded.
 */
export async function finishCapture(
  id: string,
  durationMs: number,
  audioPath: string,
): Promise<void> {
  const now = nowIso();
  await executeTransaction([
    {
      sql: `UPDATE captures SET ended_at = ?, duration_ms = ?, audio_path = ?, updated_at = ?
            WHERE id = ? AND capture_status IN ('starting', 'recording', 'stopping')`,
      params: [now, durationMs, audioPath, now, id],
    },
  ]);
  await setCaptureLifecycle(id, { capture: 'stopped' });
}

/** Record that a capture ended badly, keeping why. */
export async function failCapture(id: string, errorCode: string): Promise<void> {
  const now = nowIso();
  await executeTransaction([
    {
      sql: `UPDATE captures SET ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?`,
      params: [now, now, id],
    },
  ]);
  await setCaptureLifecycle(id, { capture: 'failed', errorCode });
}

/** Record that a capture's transcript is done. */
export async function completeCapture(id: string): Promise<void> {
  await setCaptureLifecycle(id, { transcription: 'complete', errorCode: null });
}

/**
 * Bump and read a capture's transcript revision, in one statement.
 *
 * `RETURNING` rather than an update followed by a select: the number this hands
 * back is what every processing task is judged against, and two callers reading
 * the same value would both believe their work was current.
 *
 * @returns the new revision, or null when the capture no longer exists.
 */
export async function bumpTranscriptRevision(id: string): Promise<number | null> {
  const rows = await execute<{ transcript_revision: number }>(
    `UPDATE captures SET transcript_revision = transcript_revision + 1, updated_at = ?
     WHERE id = ? RETURNING transcript_revision`,
    [nowIso(), id],
  );
  return rows[0]?.transcript_revision ?? null;
}

/**
 * Mark every capture still claiming to hold the microphone as interrupted.
 *
 * Run once at startup. Nothing else can move those rows: the process that owned
 * the microphone is gone, so without this they stay `recording` forever and the
 * UI shows a recording that is not happening. The audio already on disk is
 * untouched, which is what makes deferred transcription possible.
 *
 * `starting` and `stopping` are swept too. A process killed during startup never
 * reached `recording`, and one killed mid-stop never reached `stopped`; both
 * leave a row nothing will ever move, and only sweeping one of the three states
 * leaves the others stuck for good.
 *
 * @returns how many were recovered.
 */
export async function recoverInterruptedCaptures(): Promise<number> {
  const now = nowIso();
  const interrupted = legacyStateFromLifecycle({
    capture: 'interrupted',
    transcription: 'pending',
    generation: 'idle',
    enhancement: 'pending',
  });
  const affected = await executeTransaction([
    {
      sql: `UPDATE captures SET state = ?, capture_status = 'interrupted',
              transcription_status = 'pending', generation_status = 'idle',
              enhancement_status = 'pending',
              ended_at = COALESCE(ended_at, ?), updated_at = ?
            WHERE capture_status IN ('starting', 'recording', 'stopping')`,
      params: [interrupted, now, now],
    },
  ]);
  return affected[0] ?? 0;
}

/**
 * Delete a note's recordings: the audio, the transcript, the artifacts, the rows.
 *
 * One place, because a recording is four things in three stores and forgetting
 * one of them means a user who deleted a meeting still has its audio on their
 * device. The audio goes first: it is the part that is not in SQLite, so a
 * failure half-way leaves rows pointing at nothing rather than bytes nobody can
 * find.
 *
 * @returns how many captures were removed.
 */
export async function deleteNoteRecordings(noteId: string): Promise<number> {
  const captures = rowsToCaptures(await execute<CaptureRow>(CAPTURE_BY_NOTE_SQL, [noteId]));

  for (const capture of captures) {
    await deleteCaptureAudio(capture.audioPath, capture.id).catch(() => undefined);
  }

  const affected = await executeTransaction([
    {
      sql: `DELETE FROM transcript_segments WHERE capture_id IN
              (SELECT id FROM captures WHERE note_id = ?)`,
      params: [noteId],
    },
    { sql: 'DELETE FROM note_artifacts WHERE note_id = ?', params: [noteId] },
    { sql: 'DELETE FROM note_item_overrides WHERE note_id = ?', params: [noteId] },
    { sql: 'DELETE FROM captures WHERE note_id = ?', params: [noteId] },
  ]);
  return affected[affected.length - 1] ?? 0;
}

/**
 * Delete one recording's audio, keeping everything else.
 *
 * The note stays, the transcript stays, and the note's citations still resolve to
 * text — what is lost is playback. `audio_path` is cleared in the same breath, so
 * nothing is left pointing at bytes that are gone: a row naming a deleted file is
 * how a "play" button appears and then fails.
 */
export async function deleteRecordingAudio(capture: Capture): Promise<void> {
  await deleteCaptureAudio(capture.audioPath, capture.id);
  await executeTransaction([
    {
      sql: `UPDATE captures SET audio_path = '', updated_at = ? WHERE id = ?`,
      params: [nowIso(), capture.id],
    },
  ]);
}

/**
 * Delete one recording's transcript, keeping the note and the audio.
 *
 * The note survives word for word — it was written INTO the note, not held in the
 * transcript — but its generated lines stop being checkable, and that is the
 * whole cost of this control. The transcript revision is left where it is on
 * purpose: it counts what the recogniser has produced, and pretending none of it
 * ever existed would let a stale processing task believe it is current again.
 */
export async function deleteRecordingTranscript(capture: Capture): Promise<void> {
  await executeTransaction([
    { sql: 'DELETE FROM transcript_segments WHERE capture_id = ?', params: [capture.id] },
  ]);
}

/* ── Reads ─────────────────────────────────────────────────────── */

const CAPTURE_COLUMNS = `id, note_id, state, capture_status, transcription_status,
  generation_status, enhancement_status, profile, transcript_revision, started_at, ended_at,
  duration_ms, audio_path, language, error_code`;

const CAPTURE_BY_NOTE_SQL = `SELECT ${CAPTURE_COLUMNS} FROM captures WHERE note_id = ? ORDER BY started_at DESC`;

/**
 * Captures with work left to do.
 *
 * Asked of the three statuses rather than of the old enum, so a capture whose
 * audio is safe but whose NOTE failed is offered for retry — under one column
 * that row was indistinguishable from a finished one.
 */
const PENDING_CAPTURES_SQL = `
SELECT ${CAPTURE_COLUMNS} FROM captures
WHERE capture_status = 'interrupted'
   OR transcription_status IN ('pending', 'running', 'failed')
   OR generation_status IN ('finalizing', 'failed')
   OR enhancement_status IN ('running', 'failed')
ORDER BY started_at ASC
`;

export async function getCapture(id: string): Promise<Capture | null> {
  return firstRowToCapture(
    await execute<CaptureRow>(`SELECT ${CAPTURE_COLUMNS} FROM captures WHERE id = ?`, [id]),
  );
}

/** Captures still awaiting a transcript or a note — what recovery lists. */
export async function getPendingCaptures(): Promise<Capture[]> {
  return rowsToCaptures(await execute<CaptureRow>(PENDING_CAPTURES_SQL));
}

/** A note's recordings, newest first. */
export function useNoteCaptures(noteId: string | undefined): {
  data: Capture[];
  isLoading: boolean;
} {
  const { data, isLoading } = useLiveQuery<CaptureRow, Capture[]>({
    sql: CAPTURE_BY_NOTE_SQL,
    params: [noteId ?? ''],
    mapRows: rowsToCaptures,
  });
  return { data, isLoading };
}

/* ── Transcript segments ───────────────────────────────────────── */

export interface TranscriptSegment {
  /** Derived from the position, never minted — see `lib/stt/segment-id.ts`. */
  id: string;
  captureId: string;
  sliceIndex: number;
  segmentIndex: number;
  /** Bumped each time the recogniser re-reads this position and says something new. */
  revision: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  speakerHint: string | null;
  /** False while the recogniser may still revise this segment. */
  isFinal: boolean;
}

export interface TranscriptSegmentRow extends Row {
  id: string;
  capture_id: string;
  slice_index: number;
  segment_index: number;
  revision: number;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
  speaker_hint: string | null;
  is_final: number;
}

/**
 * Build a segment from where it sits in the recording.
 *
 * The one place a segment id is decided. Every recogniser — the phone's, the
 * browser's, and the deferred pass over a finished file — comes through here, so
 * a re-emitted slice lands on the row it already wrote instead of beside it.
 */
export function makeSegment(input: {
  captureId: string;
  sliceIndex: number;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  speakerHint?: string | null;
  revision?: number;
  isFinal?: boolean;
}): TranscriptSegment {
  return {
    id: segmentId(input),
    captureId: input.captureId,
    sliceIndex: input.sliceIndex,
    segmentIndex: input.segmentIndex,
    revision: input.revision ?? 0,
    startMs: input.startMs,
    endMs: input.endMs,
    text: input.text,
    confidence: input.confidence ?? null,
    speakerHint: input.speakerHint ?? null,
    isFinal: input.isFinal ?? true,
  };
}

export function rowsToSegments(rows: readonly TranscriptSegmentRow[]): TranscriptSegment[] {
  return rows.map((row) => ({
    id: row.id,
    captureId: row.capture_id,
    sliceIndex: row.slice_index,
    segmentIndex: row.segment_index,
    revision: row.revision,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    confidence: row.confidence,
    speakerHint: row.speaker_hint,
    isFinal: row.is_final === 1,
  }));
}

export const SEGMENTS_BY_CAPTURE_SQL = `
SELECT id, capture_id, slice_index, segment_index, revision, start_ms, end_ms,
       text, confidence, speaker_hint, is_final
FROM transcript_segments WHERE capture_id = ? ORDER BY start_ms ASC, segment_index ASC
`;

/**
 * Write transcript segments, updating any this recogniser has already written.
 *
 * `revision` decides, not arrival order: a slow re-read of an earlier slice must
 * not replace a newer reading of the same position with an older one. The guard
 * is a `WHERE` on the conflict branch, so it is the database that refuses rather
 * than a caller comparing before it writes.
 */
export function upsertSegments(segments: readonly TranscriptSegment[]): Promise<number[]> {
  const now = nowIso();
  return executeTransaction(
    segments.map((segment) => ({
      sql: `INSERT INTO transcript_segments (
              id, capture_id, slice_index, segment_index, revision, start_ms, end_ms,
              text, confidence, speaker_hint, is_final, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
              revision = excluded.revision,
              start_ms = excluded.start_ms,
              end_ms = excluded.end_ms,
              text = excluded.text,
              confidence = excluded.confidence,
              speaker_hint = excluded.speaker_hint,
              is_final = excluded.is_final,
              updated_at = excluded.updated_at
            WHERE excluded.revision >= transcript_segments.revision`,
      params: [
        segment.id,
        segment.captureId,
        segment.sliceIndex,
        segment.segmentIndex,
        segment.revision,
        segment.startMs,
        segment.endMs,
        segment.text,
        segment.confidence,
        segment.speakerHint,
        segment.isFinal ? 1 : 0,
        now,
        now,
      ],
    })),
  );
}

/** A capture's transcript so far, updating as segments land. */
export function useCaptureTranscript(captureId: string | undefined): {
  data: TranscriptSegment[];
  isLoading: boolean;
} {
  const { data, isLoading } = useLiveQuery<TranscriptSegmentRow, TranscriptSegment[]>({
    sql: SEGMENTS_BY_CAPTURE_SQL,
    params: [captureId ?? ''],
    mapRows: rowsToSegments,
  });
  return { data, isLoading };
}
