/**
 * The note anyone gets with nothing downloaded.
 *
 * Ported from the tests that covered `structureTranscript`, which produced
 * Markdown directly. The assertions are the same behaviours — they are now made
 * against the artifact and, where the question is genuinely about the rendered
 * note, against the composer that renders it.
 */

import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { allItems } from '@/lib/artifact/artifact';
import { composeNote } from '@/lib/artifact/compose';
import {
  buildDeterministicArtifact,
  deriveTitle,
} from '@/lib/artifact/generate/deterministic';
import { renderArtifact } from '@/lib/artifact/render';
import type { GeneratedNoteArtifact } from '@/lib/artifact/types';

const CAPTURE_ID = 'c1';
const NOTE_ID = 'n1';
const startedAt = new Date('2026-08-08T10:00:00Z');

function segment(startMs: number, endMs: number, text: string): TranscriptSegment {
  return {
    id: `${CAPTURE_ID}#0.${String(startMs)}`,
    captureId: CAPTURE_ID,
    sliceIndex: 0,
    segmentIndex: startMs,
    revision: 0,
    startMs,
    endMs,
    text,
    confidence: null,
    speakerHint: null,
    isFinal: true,
  };
}

function build(segments: readonly TranscriptSegment[]): GeneratedNoteArtifact {
  return buildDeterministicArtifact({
    noteId: NOTE_ID,
    captureId: CAPTURE_ID,
    segments,
    startedAt,
    stage: 'live',
    transcriptRevision: 1,
    now: '2026-08-08T10:05:00.000Z',
  });
}

const MEETING = [
  segment(0, 4_000, 'eh, buenos días, empezamos la revisión del presupuesto.'),
  segment(4_200, 9_000, 'Al final vamos a usar el proveedor barato.'),
  segment(9_200, 14_000, 'Hay que enviar el contrato antes del viernes.'),
  segment(14_200, 18_000, '¿Quién habla con el proveedor?'),
];

describe('deriveTitle', () => {
  it('takes the recording’s opening sentence', () => {
    expect(deriveTitle([{ text: 'Revisión del presupuesto de agosto. Empezamos.' }], 'fallback')).toBe(
      'Revisión del presupuesto de agosto',
    );
  });

  it('clips a long opening at a word boundary', () => {
    const source = 'Reunión larguísima sobre la planificación trimestral del equipo de producto';
    const title = deriveTitle([{ text: source }], 'fallback');
    expect(title.endsWith('…')).toBe(true);
    // Cut between words, never through one.
    expect(title.replace('…', '').endsWith(' ')).toBe(false);
    expect(source).toContain(title.replace('…', ''));
  });

  it('falls back when there is nothing to take', () => {
    expect(deriveTitle([], '8 Aug 2026, 10:00')).toBe('8 Aug 2026, 10:00');
  });
});

describe('building a meeting', () => {
  const artifact = build(MEETING);

  it('names the note from its opening', () => {
    expect(artifact.title?.text).toBe('Buenos días, empezamos la revisión del presupuesto');
  });

  it('puts the commitment in the checklist and nowhere else', () => {
    // Two copies of one task disagree the moment either is ticked.
    const actions = artifact.checklists.flatMap((checklist) => checklist.items);
    expect(actions.map((item) => item.text)).toEqual([
      'Hay que enviar el contrato antes del viernes.',
    ]);
    expect(actions[0].checked).toBe(false);
    expect(renderArtifact(artifact)).not.toContain('Hay que enviar el contrato');
  });

  it('keeps the decision and the unanswered question apart', () => {
    const rendered = renderArtifact(artifact);
    expect(rendered).toContain('## Decisions');
    expect(rendered).toContain('Al final vamos a usar el proveedor barato.');
    expect(rendered).toContain('## Open questions');
    expect(rendered).toContain('¿Quién habla con el proveedor?');
  });

  it('does not reproduce the transcript', () => {
    // A note that reproduces everything said is a transcript with headings, and
    // reading it back is the work the app was supposed to do. Counted rather
    // than matched on a heading string: the highlights section is legitimately
    // called "Transcript highlights", and a substring check would now pass or
    // fail on the wording rather than on the behaviour.
    const lines = renderArtifact(artifact)
      .split('\n')
      .filter((line) => line.startsWith('- '));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(MEETING.length);
  });

  it('can point at the recording for every line it wrote', () => {
    // Extractive, never generative: each line is a sentence somebody said, and
    // it carries the segments it came from.
    for (const item of allItems(artifact)) {
      expect(item.origin, item.text).toBe('transcript');
      expect(item.sources.length, item.text).toBeGreaterThan(0);
      expect(item.sources[0].segmentIds.length, item.text).toBeGreaterThan(0);
    }
  });
});

describe('empty sections', () => {
  it('omits a section rather than announcing it is empty', () => {
    const artifact = build([segment(0, 5_000, 'Estuvimos comentando cómo fue el fin de semana.')]);
    const rendered = renderArtifact(artifact);
    // "Decisions: none" reads as a finding about the meeting. Absence does not.
    expect(rendered).not.toContain('## Decisions');
    expect(rendered).not.toContain('## Open questions');
    expect(artifact.checklists).toEqual([]);
    // What somebody would actually have written down is the sentence itself.
    expect(rendered).toContain('Estuvimos comentando cómo fue el fin de semana.');
  });

  it('writes nothing when nothing was said', () => {
    // The floor under the test above: a note is still allowed to be empty. Half
    // a dozen fragments carry no sentence worth keeping, and padding a note with
    // them would make the previous test pass for the wrong reason.
    const artifact = build([
      segment(0, 2_000, 'Sí.'),
      segment(2_100, 3_000, 'Ya.'),
      segment(3_100, 4_000, 'Vale.'),
    ]);
    expect(renderArtifact(artifact)).toBe('');
  });

  it('produces a usable note from a recording of silence', () => {
    const artifact = build([]);
    expect(artifact.title?.text).toBe(startedAt.toLocaleString());
    expect(renderArtifact(artifact)).toBe('');
    expect(artifact.checklists).toEqual([]);
    // The date came from a clock, not from the recording, so it claims no source.
    expect(artifact.title?.sources).toEqual([]);
  });
});

describe('repetition', () => {
  it('does not repeat a commitment restated later in the meeting', () => {
    const artifact = build([
      segment(0, 5_000, 'Hay que enviar el contrato.'),
      segment(60_000, 65_000, 'Hay que enviar el contrato'),
      segment(120_000, 125_000, '¡Hay que enviar el contrato!'),
    ]);
    // Same commitment, three times, with different punctuation each time.
    expect(artifact.checklists.flatMap((checklist) => checklist.items)).toHaveLength(1);
  });

  it('gives the same point the same id every time it is rebuilt', () => {
    // The property the live note turns on: without it every rebuild is a new
    // note, so bullets reorder and a ticked item becomes a different item.
    const first = build(MEETING);
    const second = build([...MEETING, segment(20_000, 24_000, 'Nada más por hoy.')]);
    const firstIds = new Set(allItems(first).map((item) => item.id));
    const carried = allItems(second).filter((item) => firstIds.has(item.id));
    expect(carried.length).toBeGreaterThanOrEqual(firstIds.size - 1);
  });
});

describe('what the user wrote', () => {
  // The person keeps typing their own sparse notes while the meeting runs, and
  // the transcript enriches those. Overwriting what somebody typed during their
  // own meeting would be worse than producing no note.
  it('comes first, keeps their title, and keeps their ticks', () => {
    const artifact = build([
      segment(0, 5_000, 'Al final vamos a usar el proveedor barato.'),
      segment(5_200, 9_000, 'Hay que enviar el contrato antes del viernes.'),
    ]);

    const composed = composeNote({
      user: {
        title: 'Presupuesto Q3',
        body: '- ojo con el margen\n- preguntar por el descuento',
        checklist: [{ id: 'mine', text: 'Llamar a Ana', checked: true }],
      },
      live: artifact,
      fallbackTitle: startedAt.toLocaleString(),
    });

    expect(composed.title).toBe('Presupuesto Q3');
    expect(composed.body.startsWith('- ojo con el margen')).toBe(true);
    expect(composed.body).toContain('preguntar por el descuento');
    expect(composed.body).toContain('Al final vamos a usar el proveedor barato.');
    expect(composed.checklist[0]).toEqual({ id: 'mine', text: 'Llamar a Ana', checked: true });
    expect(composed.checklist.map((item) => item.text)).toContain(
      'Hay que enviar el contrato antes del viernes.',
    );
  });

  it('does not get a task added that they had already written down', () => {
    const artifact = build([segment(0, 5_000, 'Hay que enviar el contrato.')]);
    const composed = composeNote({
      user: {
        title: '',
        body: '',
        checklist: [{ id: 'mine', text: 'hay que enviar el contrato', checked: false }],
      },
      live: artifact,
      fallbackTitle: startedAt.toLocaleString(),
    });
    // Same commitment, typed and spoken. One item, and it is theirs.
    expect(composed.checklist).toHaveLength(1);
    expect(composed.checklist[0].id).toBe('mine');
  });
});

describe('headings', () => {
  it('are the caller’s, so the note can be in the user’s language', () => {
    const artifact = build([segment(0, 5_000, 'Al final vamos a usar Postgres.')]);
    const rendered = renderArtifact(artifact, {
      decisions: 'Decisiones',
      questions: 'Preguntas abiertas',
      actions: 'Acciones',
      concepts: 'Conceptos',
      examples: 'Ejemplos',
      ideas: 'Ideas',
      takeaways: 'Conclusiones',
      shopping: 'Compra',
      packing: 'Equipaje',
      steps: 'Pasos',
      speaker: 'Ponente',
      highlights: 'Puntos de la transcripción',
    });
    expect(rendered).toContain('## Decisiones');
    expect(rendered).not.toContain('## Decisions');
  });
});
