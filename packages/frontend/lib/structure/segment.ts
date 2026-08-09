/**
 * Turning a stream of transcript segments into paragraphs.
 *
 * A transcript arrives as whatever chunks the recogniser decided on — often a
 * phrase at a time — which reads as a wall of fragments. Grouping them back into
 * blocks is what makes the note readable before any summarising happens, and it
 * is done from the timing the recogniser already provides rather than from an
 * understanding of the words.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';

/**
 * A gap this long ends a paragraph.
 *
 * Long enough to skip the pauses inside a sentence and between speakers taking
 * turns, short enough to catch someone finishing a topic. Eight seconds is a
 * silence nobody leaves mid-thought.
 */
export const PARAGRAPH_GAP_MS = 8_000;

/**
 * A paragraph is cut at this length even without a pause.
 *
 * Someone can talk for ten minutes without an eight-second gap, and a single
 * ten-minute paragraph is exactly the wall of text this module exists to avoid.
 */
export const MAX_PARAGRAPH_CHARS = 900;

export interface Block {
  startMs: number;
  endMs: number;
  text: string;
  /** The speaker the recogniser attributed this to, when it attributed one. */
  speaker: string | null;
}

/**
 * Group segments into paragraph-sized blocks.
 *
 * Three things end a block: a long silence, a change of speaker, and a length
 * cap. Segments are assumed to arrive in time order, which is how they are
 * stored and read.
 */
export function groupIntoBlocks(segments: readonly TranscriptSegment[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let previousEndMs = 0;

  for (const segment of segments) {
    const text = segment.text.trim();
    if (text === '') continue;

    const silenceBroke = current !== null && segment.startMs - previousEndMs >= PARAGRAPH_GAP_MS;
    const speakerChanged = current !== null && current.speaker !== segment.speakerHint;
    const tooLong = current !== null && current.text.length >= MAX_PARAGRAPH_CHARS;

    if (current === null || silenceBroke || speakerChanged || tooLong) {
      current = {
        startMs: segment.startMs,
        endMs: segment.endMs,
        text,
        speaker: segment.speakerHint,
      };
      blocks.push(current);
    } else {
      current.text = `${current.text} ${text}`;
      current.endMs = segment.endMs;
    }

    previousEndMs = segment.endMs;
  }

  return blocks;
}

/** `mm:ss`, or `h:mm:ss` once a recording passes an hour. */
export function formatOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${String(hours)}:${mm}:${ss}` : `${mm}:${ss}`;
}
