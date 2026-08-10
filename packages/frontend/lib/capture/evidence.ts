/**
 * Getting from a line in the note back to the moment it came from.
 *
 * The claim the whole artifact model is built to support: every generated point
 * can be checked against what was actually said. This is where that becomes
 * something a screen can render — the transcript excerpt behind an item, and the
 * timestamp to start playback from.
 *
 * Resolved by segment id, not by searching the transcript for the item's text. A
 * text search finds the wrong moment whenever a model paraphrased, and finds
 * nothing at all whenever it summarised two sentences into one — which is most of
 * the time, and exactly when a reader most wants to check.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import type { GeneratedItem, SourceRange } from '@/lib/artifact/types';

export interface Evidence {
  startMs: number;
  endMs: number;
  /** The transcript, as it was said, for this stretch of the recording. */
  text: string;
  segmentIds: string[];
}

function excerptOf(range: SourceRange, byId: ReadonlyMap<string, TranscriptSegment>): Evidence | null {
  const segments = range.segmentIds
    .map((id) => byId.get(id))
    .filter((segment): segment is TranscriptSegment => segment !== undefined)
    .sort((left, right) => left.startMs - right.startMs);

  if (segments.length === 0) {
    // A range whose segments are gone — a transcript re-run, a partial delete.
    // The timestamps still point at the right moment of the audio, so the range
    // is worth keeping; there is simply nothing to quote.
    return range.endMs > range.startMs
      ? { startMs: range.startMs, endMs: range.endMs, text: '', segmentIds: [] }
      : null;
  }

  return {
    startMs: Math.min(range.startMs, segments[0].startMs),
    endMs: Math.max(range.endMs, segments[segments.length - 1].endMs),
    text: segments.map((segment) => segment.text.trim()).join(' ').trim(),
    segmentIds: segments.map((segment) => segment.id),
  };
}

/**
 * Everything backing one generated item, oldest first.
 *
 * Empty for an item nothing supports — a model's unsourced sentence, or something
 * Noted supplied under an authorisation. That emptiness is a fact worth
 * rendering, not a gap to paper over: it is how a reader tells a claim they can
 * check from one they cannot.
 */
export function evidenceFor(
  item: GeneratedItem,
  segments: readonly TranscriptSegment[],
): Evidence[] {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  return item.sources
    .map((range) => excerptOf(range, byId))
    .filter((evidence): evidence is Evidence => evidence !== null)
    .sort((left, right) => left.startMs - right.startMs);
}

/**
 * Where playback should start for an item.
 *
 * The earliest moment it draws on, because a point combining three moments is
 * best understood from the first — and because a reader who lands mid-sentence
 * assumes the link is broken.
 *
 * @returns null when the item is not grounded in the recording at all.
 */
export function playbackStartOf(item: GeneratedItem, segments: readonly TranscriptSegment[]): number | null {
  const evidence = evidenceFor(item, segments);
  return evidence.length > 0 ? evidence[0].startMs : null;
}

/**
 * Whether the item is something the reader can check.
 *
 * Deliberately not the same question as "did a model write it": a derived item is
 * honestly unsourced and says so through its origin, while an ungrounded item
 * claiming to come from the transcript is the one worth noticing.
 */
export function isCheckable(item: GeneratedItem, segments: readonly TranscriptSegment[]): boolean {
  return evidenceFor(item, segments).some((evidence) => evidence.text !== '');
}
