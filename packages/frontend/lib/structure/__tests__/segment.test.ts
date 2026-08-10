import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { formatOffset, groupIntoBlocks, PARAGRAPH_GAP_MS } from '@/lib/structure/segment';

function segment(
  startMs: number,
  endMs: number,
  text: string,
  speakerHint: string | null = null,
): TranscriptSegment {
  return {
    // The shape `lib/stt/segment-id.ts` writes: a segment is named by where it
    // sits, so a re-emitted slice updates the row it already wrote.
    id: `c1#0.${String(startMs)}`,
    captureId: 'c1',
    sliceIndex: 0,
    segmentIndex: startMs,
    revision: 0,
    startMs,
    endMs,
    text,
    confidence: null,
    speakerHint,
    isFinal: true,
  };
}

describe('groupIntoBlocks', () => {
  it('joins segments separated by an ordinary pause', () => {
    const blocks = groupIntoBlocks([
      segment(0, 1_000, 'Empezamos la reunión'),
      segment(2_000, 3_000, 'con el presupuesto'),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Empezamos la reunión con el presupuesto');
    expect(blocks[0].endMs).toBe(3_000);
  });

  // The threshold either side, because a grouping rule that never splits and one
  // that always splits both pass a test that only checks one side of it.
  it('splits on a silence at or past the threshold, and not just below it', () => {
    const justUnder = groupIntoBlocks([
      segment(0, 1_000, 'Primera idea'),
      segment(1_000 + PARAGRAPH_GAP_MS - 1, 12_000, 'sigue la misma'),
    ]);
    expect(justUnder).toHaveLength(1);

    const atThreshold = groupIntoBlocks([
      segment(0, 1_000, 'Primera idea'),
      segment(1_000 + PARAGRAPH_GAP_MS, 12_000, 'Tema nuevo'),
    ]);
    expect(atThreshold).toHaveLength(2);
  });

  it('splits when the speaker changes', () => {
    const blocks = groupIntoBlocks([
      segment(0, 1_000, '¿Lo revisamos?', 'A'),
      segment(1_100, 2_000, 'Sí, lo miro yo', 'B'),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].speaker).toBe('B');
  });

  it('skips empty segments rather than emitting blank paragraphs', () => {
    const blocks = groupIntoBlocks([segment(0, 100, '   '), segment(200, 900, 'Hola')]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Hola');
  });

  it('carries the segments each block was built from', () => {
    // This is what lets a generated point name its evidence. A block that forgot
    // its segments is a bullet nobody can check against the recording.
    const blocks = groupIntoBlocks([
      segment(0, 1_000, 'Empezamos'),
      segment(1_200, 2_000, 'con el presupuesto'),
      segment(1_200 + PARAGRAPH_GAP_MS + 2_000, 30_000, 'Otro tema'),
    ]);
    expect(blocks[0].segmentIds).toEqual(['c1#0.0', 'c1#0.1200']);
    expect(blocks[1].segmentIds).toHaveLength(1);
  });
});

describe('formatOffset', () => {
  it('reads as minutes and seconds, and grows an hour field only when needed', () => {
    expect(formatOffset(0)).toBe('00:00');
    expect(formatOffset(65_000)).toBe('01:05');
    expect(formatOffset(3_725_000)).toBe('1:02:05');
  });
});
