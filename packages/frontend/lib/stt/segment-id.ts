/**
 * A transcript segment's name, derived rather than minted.
 *
 * whisper re-emits a slice as it fills: the same sentence arrives three or four
 * times, each time a little longer. The native path gave every emission a fresh
 * `newNoteId()`, so `INSERT OR REPLACE` had nothing to replace and each partial
 * reading was kept as its own row — the note then read the same sentence back in
 * four increasingly complete versions, which is exactly what the de-duplicator in
 * `lib/structure/similar.ts` was written to paper over.
 *
 * A segment's identity is where it sits in the recording — which slice, and which
 * segment within it — so that is what the id is made of. The re-emission then
 * lands on the row it already wrote, and the correction is an update.
 */

/** Separates the capture from the position; `#` cannot appear in a generated id. */
const CAPTURE_SEPARATOR = '#';

/** Separates slice from segment. */
const POSITION_SEPARATOR = '.';

const SEGMENT_ID_RE = /^(.+)#(\d+)\.(\d+)$/;

export interface SegmentPosition {
  captureId: string;
  sliceIndex: number;
  segmentIndex: number;
}

export function segmentId(position: SegmentPosition): string {
  return `${position.captureId}${CAPTURE_SEPARATOR}${position.sliceIndex}${POSITION_SEPARATOR}${position.segmentIndex}`;
}

/**
 * Read a position back out of an id.
 *
 * @returns null for anything this module did not write — a row from before
 *   segments had positions, most of the time. Callers treat that as "position
 *   unknown" rather than as corruption; those rows are real transcript.
 */
export function parseSegmentId(id: string): SegmentPosition | null {
  const match = SEGMENT_ID_RE.exec(id);
  if (!match) return null;
  return {
    captureId: match[1],
    sliceIndex: Number(match[2]),
    segmentIndex: Number(match[3]),
  };
}
