/**
 * The scenario the issue spells out, end to end.
 *
 * > Quiero una lista de la compra. Añade pollo, salchichas y pasta para hacer una
 * > carbonara. También pon todos los ingredientes necesarios para hacer una pizza
 * > de pollo.
 *
 * What has to come out of that is a checklist you can tick — not prose describing
 * somebody reading a list aloud — with the three spoken items, the permission to
 * complete the pizza recorded rather than acted on, and nothing invented.
 */

import { describe, expect, it } from 'vitest';

import { visibleItems } from '@/lib/artifact/artifact';
import { composeNote } from '@/lib/artifact/compose';
import { buildDeterministicArtifact } from '@/lib/artifact/generate/deterministic';
import { renderArtifact } from '@/lib/artifact/render';
import type { CaptureProfile, GeneratedNoteArtifact } from '@noted/shared-types';
import type { TranscriptSegment } from '@/lib/capture/captures-repo';

const CAPTURE_ID = 'c1';
const startedAt = new Date('2026-08-10T09:00:00Z');

function segment(index: number, text: string): TranscriptSegment {
  return {
    id: `${CAPTURE_ID}#0.${String(index)}`,
    captureId: CAPTURE_ID,
    sliceIndex: 0,
    segmentIndex: index,
    revision: 0,
    startMs: index * 6_000,
    endMs: index * 6_000 + 5_000,
    text,
    confidence: null,
    speakerHint: null,
    isFinal: true,
  };
}

function build(lines: readonly string[], profile?: CaptureProfile): GeneratedNoteArtifact {
  return buildDeterministicArtifact({
    noteId: 'n1',
    captureId: CAPTURE_ID,
    segments: lines.map((text, index) => segment(index, text)),
    startedAt,
    stage: 'live',
    profile,
    transcriptRevision: 1,
    now: '2026-08-10T09:10:00.000Z',
  });
}

const SHOPPING = [
  'Quiero una lista de la compra.',
  'Añade pollo, salchichas y pasta para hacer una carbonara.',
  'También pon todos los ingredientes necesarios para hacer una pizza de pollo.',
];

describe('a dictated shopping list', () => {
  const artifact = build(SHOPPING);

  it('knows what it is', () => {
    expect(artifact.profile).toBe('dictation');
    expect(artifact.intent).toBe('shopping-list');
    expect(artifact.checklists[0].kind).toBe('shopping');
  });

  it('is a checklist, and the body is not prose about it', () => {
    // The failure this replaces: a summary of somebody reading a list aloud.
    expect(renderArtifact(artifact)).toBe('');
    expect(visibleItems(artifact.checklists[0].items).map((item) => item.text)).toEqual([
      'pollo',
      'salchichas',
      'pasta',
    ]);
  });

  it('does not read the instruction back to the user as a note', () => {
    expect(renderArtifact(artifact)).not.toContain('lista de la compra');
    expect(artifact.openQuestions).toEqual([]);
  });

  it('records the permission to complete the pizza, and completes nothing', () => {
    // "If enrichment is unavailable, preserve explicit items and show that
    // suggested completion is pending rather than inventing a claim that it
    // completed." Nothing here can supply a recipe, so nothing pretends to.
    expect(artifact.pendingExpansions).toHaveLength(1);
    expect(artifact.pendingExpansions?.[0].subject).toBe('una pizza de pollo');
    expect(
      artifact.checklists[0].items.some((item) => item.origin === 'derived-from-instruction'),
    ).toBe(false);
  });

  it('reaches the note as a real checklist', () => {
    const composed = composeNote({
      user: { title: '', body: '', checklist: [] },
      live: artifact,
      fallbackTitle: startedAt.toLocaleString(),
    });
    expect(composed.checklist.map((item) => item.text)).toEqual(['pollo', 'salchichas', 'pasta']);
    expect(composed.body).toBe('');
  });
});

describe('correcting it out loud', () => {
  it('updates the items instead of appending contradictions', () => {
    const artifact = build([
      ...SHOPPING,
      'Quita las salchichas.',
      'Ya tengo mozzarella, no la añadas.',
      'Pon dos kilos de pollo.',
    ]);
    const items = visibleItems(artifact.checklists[0].items);
    expect(items.map((item) => item.text)).toEqual(['pollo', 'pasta']);
    expect(items[0].quantity).toBe('dos kilos');
  });

  it('carries the quantity into the line the user reads', () => {
    const artifact = build([...SHOPPING, 'Pon dos kilos de pollo.']);
    const composed = composeNote({
      user: { title: '', body: '', checklist: [] },
      live: artifact,
      fallbackTitle: startedAt.toLocaleString(),
    });
    expect(composed.checklist[0].text).toBe('dos kilos pollo');
  });
});

describe('a list dictated inside a meeting', () => {
  // Both survive: the meeting is still a meeting, and the list is still a list.
  const artifact = build([
    'Empezamos la reunión. El primer punto del día es el presupuesto del trimestre.',
    'Al final vamos a usar el proveedor barato para todo el trimestre.',
    'Ah, y añade pollo y pasta a la lista de la compra.',
  ]);

  it('stays a meeting', () => {
    expect(artifact.profile).toBe('meeting');
  });

  it('keeps what was decided', () => {
    expect(renderArtifact(artifact)).toContain('proveedor barato');
  });

  it('keeps the list too', () => {
    const dictated = artifact.checklists.find((checklist) => checklist.id.endsWith(':dictated'));
    expect(visibleItems(dictated?.items ?? []).map((item) => item.text)).toEqual([
      'pollo',
      'pasta',
    ]);
  });
});

describe('the user’s choice wins', () => {
  it('a recording they filed as a lecture is not reclassified as dictation', () => {
    // Classification is an aid, never a source of truth.
    const artifact = build([...SHOPPING], 'lecture');
    expect(artifact.profile).toBe('lecture');
    // …and because it is not a dictation, what was said is kept as notes too.
    expect(artifact.checklists.some((checklist) => checklist.id.endsWith(':dictated'))).toBe(true);
  });
});

describe('ordinary discussion', () => {
  it('does not become a list because somebody mentioned one', () => {
    const artifact = build([
      'Estuvimos mirando la lista de precios que mandó el proveedor.',
      'Hablamos de hacer una pizza el sábado por la noche con el equipo.',
    ]);
    // "Hablamos de hacer una pizza" does not authorise adding flour.
    expect(artifact.pendingExpansions).toEqual([]);
    expect(artifact.checklists).toEqual([]);
    expect(artifact.profile).not.toBe('dictation');
  });
});
