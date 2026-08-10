/**
 * What this recording is keeping, and what deleting each part would cost.
 *
 * A recording is three things stored separately — the audio, the transcript, and
 * the note — and the whole point of the controls is that they can be removed
 * independently. Somebody who wants the note without an hour of audio on their
 * phone should not have to choose between keeping both and losing both.
 *
 * The consequences are not symmetric, and a control that did not say so would be
 * a control that surprises people:
 *
 * - Deleting the AUDIO costs playback. The transcript still says what was said
 *   and the note still cites it.
 * - Deleting the TRANSCRIPT costs the evidence. The note survives word for word —
 *   it was written into the note, not held in the transcript — but a generated
 *   line stops being something the reader can check, and the timestamps it points
 *   at no longer resolve to anything quotable.
 *
 * Pure, so the copy and the consequences can be checked without a database.
 */

export interface RetentionPart {
  kind: 'audio' | 'transcript';
  /** Whether there is anything to delete. */
  present: boolean;
  /** What the user loses, as an i18n key. */
  costKey: string;
  /** What survives, as an i18n key. */
  keepsKey: string;
}

export interface RetentionInput {
  /** A durable reference or a file path; empty when no audio was kept. */
  audioPath: string;
  segmentCount: number;
}

/**
 * The removable parts of a recording, in the order they should be offered.
 *
 * Audio first because it is the large one and the one people delete for space;
 * the transcript is offered second because losing it costs more than it saves.
 */
export function retentionParts(input: RetentionInput): RetentionPart[] {
  return [
    {
      kind: 'audio',
      present: input.audioPath !== '',
      costKey: 'capture.retention.audioCost',
      keepsKey: 'capture.retention.audioKeeps',
    },
    {
      kind: 'transcript',
      present: input.segmentCount > 0,
      costKey: 'capture.retention.transcriptCost',
      keepsKey: 'capture.retention.transcriptKeeps',
    },
  ];
}

/** Whether this recording is holding anything at all worth offering to delete. */
export function hasRemovableParts(input: RetentionInput): boolean {
  return retentionParts(input).some((part) => part.present);
}

/** Every copy key this module can produce, so a locale can be checked against it. */
export const RETENTION_KEYS: readonly string[] = retentionParts({
  audioPath: 'x',
  segmentCount: 1,
}).flatMap((part) => [part.costKey, part.keepsKey]);
