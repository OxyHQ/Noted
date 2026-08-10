import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { lineAt, searchTranscript, transcriptLines } from '@/lib/capture/transcript-view';
import { PARAGRAPH_GAP_MS } from '@/lib/structure/segment';

function segment(
  index: number,
  startMs: number,
  text: string,
  over: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    id: `c1#0.${String(index)}`,
    captureId: 'c1',
    sliceIndex: 0,
    segmentIndex: index,
    revision: 0,
    startMs,
    endMs: startMs + 4_000,
    text,
    confidence: null,
    speakerHint: null,
    isFinal: true,
    ...over,
  };
}

describe('reading the transcript', () => {
  it('groups the fragments a recogniser emits into readable lines', () => {
    const lines = transcriptLines([
      segment(0, 0, 'Empezamos la reunión'),
      segment(1, 4_500, 'con el presupuesto'),
      segment(2, 4_500 + 4_000 + PARAGRAPH_GAP_MS, 'Pasamos al siguiente punto'),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Empezamos la reunión con el presupuesto');
  });

  it('keeps what was said verbatim, filler and all', () => {
    // The note is where filler is removed. The transcript is the record, and a
    // record that quietly tidies itself cannot be used to check anything.
    const lines = transcriptLines([segment(0, 0, 'eh, bueno, empezamos, ¿no?')]);
    expect(lines[0].text).toBe('eh, bueno, empezamos, ¿no?');
  });

  it('shows where in the recording each line was said', () => {
    expect(transcriptLines([segment(0, 65_000, 'Algo')])[0].offset).toBe('01:05');
  });

  it('marks a line provisional when any part of it still is', () => {
    // The optimistic reading would tell the reader the line is settled while its
    // last phrase is still being revised under them.
    const lines = transcriptLines([
      segment(0, 0, 'Ya está'),
      segment(1, 4_500, 'esto todavía no', { isFinal: false }),
    ]);
    expect(lines[0].isFinal).toBe(false);
  });

  it('says nothing about an empty transcript', () => {
    expect(transcriptLines([])).toEqual([]);
  });
});

describe('searching it', () => {
  const lines = transcriptLines([
    segment(0, 0, 'Empezamos la reunión de presupuesto'),
    segment(1, 60_000, 'Y cerramos con el proveedor'),
  ]);

  it('finds a word and says where it sits', () => {
    const results = searchTranscript(lines, 'proveedor');
    expect(results).toHaveLength(1);
    const { line, matches } = results[0];
    expect(line.text.slice(matches[0].start, matches[0].end)).toBe('proveedor');
  });

  it('does not care about accents, which nobody types', () => {
    // "reunion" finding nothing in a recording that says "reunión" reads as a
    // broken search, not as a precise one.
    const results = searchTranscript(lines, 'reunion');
    expect(results).toHaveLength(1);
    expect(results[0].line.text.slice(results[0].matches[0].start, results[0].matches[0].end)).toBe(
      'reunión',
    );
  });

  it('does not care about case', () => {
    expect(searchTranscript(lines, 'PROVEEDOR')).toHaveLength(1);
  });

  it('reports every occurrence in a line, not just the first', () => {
    const repeated = transcriptLines([segment(0, 0, 'pollo y más pollo, con pollo')]);
    expect(searchTranscript(repeated, 'pollo')[0].matches).toHaveLength(3);
  });

  it('points at the original text even when folding changed its length', () => {
    // `NFD` splits an accented character in two, so comparing lengths afterwards
    // silently misplaces every highlight in an accented line.
    const accented = transcriptLines([segment(0, 0, 'Sesión sobre la migración')]);
    const { line, matches } = searchTranscript(accented, 'migracion')[0];
    expect(line.text.slice(matches[0].start, matches[0].end)).toBe('migración');
  });

  it('finds nothing for an empty query rather than everything', () => {
    expect(searchTranscript(lines, '   ')).toEqual([]);
  });
});

describe('jumping to a moment', () => {
  const lines = transcriptLines([
    segment(0, 0, 'Primera parte'),
    segment(1, 60_000, 'Segunda parte'),
  ]);

  it('lands on the line containing it', () => {
    expect(lineAt(lines, 61_000)?.text).toBe('Segunda parte');
  });

  it('lands on what comes next when the moment falls in a silence', () => {
    // A tap that appears to do nothing is worse than one that lands nearby.
    expect(lineAt(lines, 30_000)?.text).toBe('Segunda parte');
  });

  it('lands on the last line for a moment past the end', () => {
    expect(lineAt(lines, 999_000)?.text).toBe('Segunda parte');
  });

  it('has nowhere to land in an empty transcript', () => {
    expect(lineAt([], 0)).toBeNull();
  });
});
