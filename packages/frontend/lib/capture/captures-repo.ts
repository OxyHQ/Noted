/**
 * Recordings in the local store.
 *
 * A capture is a recording session: the audio file on disk plus how far
 * transcription got. It is written before the microphone opens and updated as
 * it progresses, so a capture that outlives its process leaves enough behind to
 * be recovered rather than silently lost — which is the whole point of writing
 * the row first.
 */

import { execute, executeTransaction, type Row } from '@/lib/db/client';
import { useLiveQuery } from '@/lib/db/live-query';

/**
 * Where a capture is in its life.
 *
 * `recording` is the only state that can be wrong after a crash: the process
 * that owned it is gone, so nothing will ever move it forward. Startup rewrites
 * any such row to `interrupted` — see {@link recoverInterruptedCaptures}.
 */
export type CaptureState =
  | 'recording'
  | 'interrupted'
  | 'transcribing'
  | 'complete'
  | 'failed';

export interface CaptureRow extends Row {
  id: string;
  note_id: string;
  state: string;
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
  state: CaptureState;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  audioPath: string;
  errorCode: string | null;
}

const CAPTURE_STATES: readonly string[] = [
  'recording',
  'interrupted',
  'transcribing',
  'complete',
  'failed',
];

function toCaptureState(value: string): CaptureState {
  // An unrecognised state means a row written by a newer build. Treating it as
  // failed keeps it visible and inert rather than letting it look active.
  return (CAPTURE_STATES.includes(value) ? value : 'failed') as CaptureState;
}

function rowToCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    noteId: row.note_id,
    state: toCaptureState(row.state),
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
 * is the only evidence the recording ever existed, and the audio file it names
 * is what recovery transcribes.
 */
export async function beginCapture(input: {
  id: string;
  noteId: string;
  audioPath: string;
  language?: string;
}): Promise<void> {
  const now = nowIso();
  await executeTransaction([
    {
      sql: `INSERT INTO captures (
              id, note_id, state, started_at, ended_at, duration_ms, audio_path,
              audio_file_id, model_id, language, error_code, created_at, updated_at
            ) VALUES (?, ?, 'recording', ?, NULL, 0, ?, NULL, NULL, ?, NULL, ?, ?)`,
      params: [input.id, input.noteId, now, input.audioPath, input.language ?? null, now, now],
    },
  ]);
}

/** Record that the recording stopped cleanly and how long it ran. */
export async function finishCapture(id: string, durationMs: number): Promise<void> {
  const now = nowIso();
  await executeTransaction([
    {
      sql: `UPDATE captures SET state = 'transcribing', ended_at = ?, duration_ms = ?, updated_at = ?
            WHERE id = ? AND state = 'recording'`,
      params: [now, durationMs, now, id],
    },
  ]);
}

/** Record that a capture ended badly, keeping why. */
export async function failCapture(id: string, errorCode: string): Promise<void> {
  const now = nowIso();
  await executeTransaction([
    {
      sql: `UPDATE captures SET state = 'failed', ended_at = COALESCE(ended_at, ?), error_code = ?, updated_at = ?
            WHERE id = ?`,
      params: [now, errorCode, now, id],
    },
  ]);
}

/** Record that a capture's transcript is done. */
export async function completeCapture(id: string): Promise<void> {
  const now = nowIso();
  await executeTransaction([
    {
      sql: `UPDATE captures SET state = 'complete', error_code = NULL, updated_at = ? WHERE id = ?`,
      params: [now, id],
    },
  ]);
}

/**
 * Mark every capture still claiming to be recording as interrupted.
 *
 * Run once at startup. Nothing else can move those rows: the process that owned
 * the microphone is gone, so without this they stay `recording` forever and the
 * UI shows a recording that is not happening. The audio already on disk is
 * untouched, which is what makes deferred transcription possible.
 *
 * @returns how many were recovered.
 */
export async function recoverInterruptedCaptures(): Promise<number> {
  const now = nowIso();
  const affected = await executeTransaction([
    {
      sql: `UPDATE captures SET state = 'interrupted', ended_at = COALESCE(ended_at, ?), updated_at = ?
            WHERE state = 'recording'`,
      params: [now, now],
    },
  ]);
  return affected[0] ?? 0;
}

/* ── Reads ─────────────────────────────────────────────────────── */

const CAPTURE_COLUMNS =
  'id, note_id, state, started_at, ended_at, duration_ms, audio_path, language, error_code';

const CAPTURE_BY_NOTE_SQL = `SELECT ${CAPTURE_COLUMNS} FROM captures WHERE note_id = ? ORDER BY started_at DESC`;

const PENDING_CAPTURES_SQL = `
SELECT ${CAPTURE_COLUMNS} FROM captures
WHERE state IN ('interrupted', 'transcribing', 'failed')
ORDER BY started_at ASC
`;

export async function getCapture(id: string): Promise<Capture | null> {
  return firstRowToCapture(
    await execute<CaptureRow>(`SELECT ${CAPTURE_COLUMNS} FROM captures WHERE id = ?`, [id]),
  );
}

/** Captures still awaiting a transcript — what the recovery affordance lists. */
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
  id: string;
  captureId: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  speakerHint: string | null;
}

export interface TranscriptSegmentRow extends Row {
  id: string;
  capture_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
  speaker_hint: string | null;
}

export function rowsToSegments(rows: readonly TranscriptSegmentRow[]): TranscriptSegment[] {
  return rows.map((row) => ({
    id: row.id,
    captureId: row.capture_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    confidence: row.confidence,
    speakerHint: row.speaker_hint,
  }));
}

export const SEGMENTS_BY_CAPTURE_SQL = `
SELECT id, capture_id, start_ms, end_ms, text, confidence, speaker_hint
FROM transcript_segments WHERE capture_id = ? ORDER BY start_ms ASC
`;

/**
 * Append transcript segments.
 *
 * Written as they arrive rather than at the end, so a transcription interrupted
 * half-way keeps what it had understood so far.
 */
export function appendSegments(segments: readonly TranscriptSegment[]): Promise<number[]> {
  const now = nowIso();
  return executeTransaction(
    segments.map((segment) => ({
      sql: `INSERT OR REPLACE INTO transcript_segments (
              id, capture_id, start_ms, end_ms, text, confidence, speaker_hint, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        segment.id,
        segment.captureId,
        segment.startMs,
        segment.endMs,
        segment.text,
        segment.confidence,
        segment.speakerHint,
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
