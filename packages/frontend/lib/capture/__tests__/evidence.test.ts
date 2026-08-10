import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { evidenceFor, isCheckable, playbackStartOf } from '@/lib/capture/evidence';
import type { GeneratedItem, SourceRange } from '@/lib/artifact/types';

const CAPTURE_ID = 'c1';

function segment(index: number, startMs: number, text: string): TranscriptSegment {
  return {
    id: `${CAPTURE_ID}#0.${String(index)}`,
    captureId: CAPTURE_ID,
    sliceIndex: 0,
    segmentIndex: index,
    revision: 0,
    startMs,
    endMs: startMs + 4_000,
    text,
    confidence: null,
    speakerHint: null,
    isFinal: true,
  };
}

const TRANSCRIPT = [
  segment(0, 0, 'Empezamos con el presupuesto'),
  segment(1, 6_000, 'Al final vamos a usar el proveedor barato'),
  segment(2, 60_000, 'Y lo confirmamos con el proveedor barato'),
];

function range(startMs: number, endMs: number, ...segmentIds: string[]): SourceRange {
  return { captureId: CAPTURE_ID, startMs, endMs, segmentIds };
}

function item(sources: SourceRange[]): GeneratedItem {
  return { id: 'n1', text: 'Usamos el proveedor barato', status: 'active', origin: 'transcript', sources };
}

describe('evidenceFor', () => {
  it('quotes what was actually said', () => {
    const evidence = evidenceFor(item([range(6_000, 10_000, 'c1#0.1')]), TRANSCRIPT);
    expect(evidence).toEqual([
      {
        startMs: 6_000,
        endMs: 10_000,
        text: 'Al final vamos a usar el proveedor barato',
        segmentIds: ['c1#0.1'],
      },
    ]);
  });

  it('joins the segments of one stretch in the order they were said', () => {
    const evidence = evidenceFor(
      item([range(0, 10_000, 'c1#0.1', 'c1#0.0')]),
      TRANSCRIPT,
    );
    expect(evidence[0].text).toBe('Empezamos con el presupuesto Al final vamos a usar el proveedor barato');
  });

  it('keeps both moments when a point was made twice', () => {
    // A point somebody made at 00:06 and again at 01:00 is evidenced twice, and
    // a reader deserves to see both rather than whichever came first.
    const evidence = evidenceFor(
      item([range(60_000, 64_000, 'c1#0.2'), range(6_000, 10_000, 'c1#0.1')]),
      TRANSCRIPT,
    );
    expect(evidence.map((entry) => entry.startMs)).toEqual([6_000, 60_000]);
  });

  it('resolves by id rather than by looking for the text', () => {
    // A model paraphrases, and a model that summarised two sentences into one
    // matches nothing at all — which is exactly when a reader wants to check.
    const paraphrase: GeneratedItem = {
      ...item([range(6_000, 10_000, 'c1#0.1')]),
      text: 'Se eligió la opción más barata',
    };
    expect(evidenceFor(paraphrase, TRANSCRIPT)[0].text).toBe(
      'Al final vamos a usar el proveedor barato',
    );
  });

  it('says nothing for an item nothing supports', () => {
    // Emptiness is a fact worth rendering: it is how a reader tells a claim they
    // can check from one they cannot.
    expect(evidenceFor(item([]), TRANSCRIPT)).toEqual([]);
    expect(isCheckable(item([]), TRANSCRIPT)).toBe(false);
  });

  it('keeps the timestamps when the segments themselves are gone', () => {
    // A re-run transcript, or a partial delete. The moment is still right even
    // though there is nothing left to quote.
    const evidence = evidenceFor(item([range(6_000, 10_000, 'c1#0.99')]), TRANSCRIPT);
    expect(evidence).toEqual([{ startMs: 6_000, endMs: 10_000, text: '', segmentIds: [] }]);
    expect(isCheckable(item([range(6_000, 10_000, 'c1#0.99')]), TRANSCRIPT)).toBe(false);
  });

  it('drops a range that points at neither a segment nor a moment', () => {
    expect(evidenceFor(item([range(0, 0, 'c1#0.99')]), TRANSCRIPT)).toEqual([]);
  });
});

describe('playbackStartOf', () => {
  it('starts at the earliest moment the item draws on', () => {
    // A reader who lands mid-sentence assumes the link is broken.
    expect(
      playbackStartOf(
        item([range(60_000, 64_000, 'c1#0.2'), range(6_000, 10_000, 'c1#0.1')]),
        TRANSCRIPT,
      ),
    ).toBe(6_000);
  });

  it('is nothing at all for an item that is not grounded', () => {
    expect(playbackStartOf(item([]), TRANSCRIPT)).toBeNull();
  });
});
