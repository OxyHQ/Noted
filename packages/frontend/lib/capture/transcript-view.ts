/**
 * The transcript, as something a person can read and search.
 *
 * The app has stored segments since the beginning and never showed them, which
 * left every generated line unverifiable in practice: the evidence existed and
 * there was no surface on which to look at it. This is the reading layer —
 * grouping, search, and the mapping from a moment in the note to a place in the
 * transcript.
 *
 * Segments are not lines. A recogniser emits a phrase at a time, so a raw list is
 * a wall of fragments; the same grouping the note generator uses is what makes it
 * readable. What differs here is that nothing is dropped — a transcript view that
 * cleaned up its input would be lying about what was said, which is the one thing
 * it exists not to do.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { groupIntoBlocks } from '@/lib/structure/segment';
import { formatOffset } from '@/lib/structure/segment';

export interface TranscriptLineView {
  id: string;
  startMs: number;
  endMs: number;
  /** `mm:ss`, or `h:mm:ss` past an hour. */
  offset: string;
  text: string;
  segmentIds: string[];
  /** Whether this line is still allowed to change under the reader. */
  isFinal: boolean;
}

/**
 * Group the transcript into readable lines.
 *
 * Verbatim: `cleanSpeech` is deliberately NOT applied. The note is where filler
 * is removed; the transcript is the record, and a record that quietly tidies
 * itself cannot be used to check anything.
 */
export function transcriptLines(segments: readonly TranscriptSegment[]): TranscriptLineView[] {
  const finalById = new Map(segments.map((segment) => [segment.id, segment.isFinal]));

  return groupIntoBlocks(segments).map((block) => ({
    id: block.segmentIds[0] ?? `at:${String(block.startMs)}`,
    startMs: block.startMs,
    endMs: block.endMs,
    offset: formatOffset(block.startMs),
    text: block.text,
    segmentIds: block.segmentIds,
    // A line is provisional if ANY segment in it still is: the reader needs to
    // know the line may change, and the optimistic reading would tell them it is
    // settled while its last phrase is still being revised.
    isFinal: block.segmentIds.every((id) => finalById.get(id) !== false),
  }));
}

/** Where a match sits inside a line, so a renderer can mark it without re-searching. */
export interface Match {
  start: number;
  end: number;
}

export interface TranscriptSearchResult {
  line: TranscriptLineView;
  matches: Match[];
}

/**
 * Fold case and accents.
 *
 * A Spanish transcript is full of accents nobody types into a search box, and
 * "reunion" finding nothing in a recording that says "reunión" reads as a broken
 * search rather than as a precise one.
 */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * The lines containing `query`, with where in each line it matched.
 *
 * Positions are into the ORIGINAL text, not the folded copy, because the folded
 * copy is what the reader never sees. `NFD` can change a string's length, so the
 * folding is done per character and the offsets mapped back — comparing lengths
 * afterwards would silently misplace every highlight in an accented line.
 */
export function searchTranscript(
  lines: readonly TranscriptLineView[],
  query: string,
): TranscriptSearchResult[] {
  const needle = fold(query.trim());
  if (needle === '') return [];

  const results: TranscriptSearchResult[] = [];
  for (const line of lines) {
    // Built character by character so each folded position maps back to the
    // original index it came from.
    let folded = '';
    const origin: number[] = [];
    for (let index = 0; index < line.text.length; index += 1) {
      const piece = fold(line.text[index]);
      for (let step = 0; step < piece.length; step += 1) origin.push(index);
      folded += piece;
    }

    const matches: Match[] = [];
    let at = folded.indexOf(needle);
    while (at !== -1) {
      const start = origin[at] ?? 0;
      const end = (origin[at + needle.length - 1] ?? start) + 1;
      matches.push({ start, end });
      at = folded.indexOf(needle, at + needle.length);
    }
    if (matches.length > 0) results.push({ line, matches });
  }
  return results;
}

/**
 * The line a moment of the recording falls in.
 *
 * What a "jump to the source" tap resolves to. Returns the line CONTAINING the
 * moment, or the one that starts next when it falls in a silence — never null for
 * a non-empty transcript, because landing somewhere sensible beats a tap that
 * appears to do nothing.
 */
export function lineAt(
  lines: readonly TranscriptLineView[],
  atMs: number,
): TranscriptLineView | null {
  if (lines.length === 0) return null;
  const containing = lines.find((line) => atMs >= line.startMs && atMs <= line.endMs);
  if (containing) return containing;
  return lines.find((line) => line.startMs >= atMs) ?? lines[lines.length - 1];
}
