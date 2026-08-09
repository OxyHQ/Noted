import { describe, expect, it } from 'vitest';

import type { TranscriptSegment } from '@/lib/capture/captures-repo';
import { formatOffset, groupIntoBlocks, PARAGRAPH_GAP_MS } from '@/lib/structure/segment';
import { deriveTitle, structureTranscript } from '@/lib/structure/structure';

let counter = 0;
const makeId = () => `id-${String((counter += 1))}`;

function segment(
  startMs: number,
  endMs: number,
  text: string,
  speakerHint: string | null = null,
): TranscriptSegment {
  return { id: `s-${String(startMs)}`, captureId: 'c1', startMs, endMs, text, confidence: null, speakerHint };
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
});

describe('formatOffset', () => {
  it('reads as minutes and seconds, and grows an hour field only when needed', () => {
    expect(formatOffset(0)).toBe('00:00');
    expect(formatOffset(65_000)).toBe('01:05');
    expect(formatOffset(3_725_000)).toBe('1:02:05');
  });
});

describe('deriveTitle', () => {
  it('takes the recording’s opening sentence', () => {
    expect(deriveTitle([{ text: 'Revisión del presupuesto de agosto. Empezamos.' }], 'fallback'))
      .toBe('Revisión del presupuesto de agosto');
  });

  it('clips a long opening at a word boundary', () => {
    const title = deriveTitle(
      [{ text: 'Reunión larguísima sobre la planificación trimestral del equipo de producto' }],
      'fallback',
    );
    expect(title.endsWith('…')).toBe(true);
    // Cut between words, never through one.
    expect(title.replace('…', '').endsWith(' ')).toBe(false);
    expect('Reunión larguísima sobre la planificación trimestral del equipo de producto')
      .toContain(title.replace('…', ''));
  });

  it('falls back when there is nothing to take', () => {
    expect(deriveTitle([], '8 Aug 2026, 10:00')).toBe('8 Aug 2026, 10:00');
  });
});

describe('structureTranscript', () => {
  const startedAt = new Date('2026-08-08T10:00:00Z');

  it('builds a note from a meeting', () => {
    const result = structureTranscript(
      [
        segment(0, 4_000, 'eh, buenos días, empezamos la revisión del presupuesto.'),
        segment(4_200, 9_000, 'Al final vamos a usar el proveedor barato.'),
        segment(9_200, 14_000, 'Hay que enviar el contrato antes del viernes.'),
        segment(14_200, 18_000, '¿Quién habla con el proveedor?'),
      ],
      { startedAt, makeId },
    );

    expect(result.title).toBe('Buenos días, empezamos la revisión del presupuesto');
    expect(result.checklist.map((item) => item.text)).toEqual([
      'Hay que enviar el contrato antes del viernes.',
    ]);
    expect(result.checklist[0].checked).toBe(false);
    expect(result.markdown).toContain('## Decisions');
    expect(result.markdown).toContain('Al final vamos a usar el proveedor barato.');
    expect(result.markdown).toContain('## Open questions');
    expect(result.markdown).toContain('¿Quién habla con el proveedor?');
    // The transcript carries offsets so a reader can go back to the audio.
    expect(result.markdown).toContain('## Transcript');
    expect(result.markdown).toContain('**00:00**');
  });

  it('omits a section rather than announcing it is empty', () => {
    const result = structureTranscript(
      [segment(0, 5_000, 'Estuvimos comentando cómo fue el fin de semana.')],
      { startedAt, makeId },
    );
    // "Decisions: none" reads as a finding about the meeting. Absence does not.
    expect(result.markdown).not.toContain('## Decisions');
    expect(result.markdown).not.toContain('## Tasks');
    expect(result.markdown).toContain('## Transcript');
    expect(result.checklist).toEqual([]);
  });

  it('does not repeat a commitment restated later in the meeting', () => {
    const result = structureTranscript(
      [
        segment(0, 5_000, 'Hay que enviar el contrato.'),
        segment(60_000, 65_000, 'Hay que enviar el contrato'),
        segment(120_000, 125_000, '¡Hay que enviar el contrato!'),
      ],
      { startedAt, makeId },
    );
    // Same commitment, three times, with different punctuation each time.
    expect(result.checklist).toHaveLength(1);
  });

  // The Granola shape: the person keeps typing their own sparse notes while the
  // meeting runs, and the transcript enriches those. Overwriting what somebody
  // typed during their own meeting would be worse than producing no note.
  it('keeps what the user wrote, and adds to it', () => {
    const result = structureTranscript(
      [
        segment(0, 5_000, 'Al final vamos a usar el proveedor barato.'),
        segment(5_200, 9_000, 'Hay que enviar el contrato antes del viernes.'),
      ],
      {
        startedAt,
        makeId,
        existing: {
          title: 'Presupuesto Q3',
          body: '- ojo con el margen\n- preguntar por el descuento',
          checklist: [{ id: 'mine', text: 'Llamar a Ana', checked: true }],
        },
      },
    );

    expect(result.title).toBe('Presupuesto Q3');
    expect(result.markdown.startsWith('- ojo con el margen')).toBe(true);
    expect(result.markdown).toContain('preguntar por el descuento');
    expect(result.markdown).toContain('Al final vamos a usar el proveedor barato.');

    // Their own item survives, ticked, and stays first.
    expect(result.checklist[0]).toEqual({ id: 'mine', text: 'Llamar a Ana', checked: true });
    expect(result.checklist.map((i) => i.text)).toContain(
      'Hay que enviar el contrato antes del viernes.',
    );
  });

  it('does not add a task the user had already written down', () => {
    const result = structureTranscript(
      [segment(0, 5_000, 'Hay que enviar el contrato.')],
      {
        startedAt,
        makeId,
        existing: {
          title: '',
          body: '',
          checklist: [{ id: 'mine', text: 'hay que enviar el contrato', checked: false }],
        },
      },
    );
    // Same commitment, typed and spoken. One item, and it is theirs.
    expect(result.checklist).toHaveLength(1);
    expect(result.checklist[0].id).toBe('mine');
  });

  it('produces a usable note from a recording of silence', () => {
    const result = structureTranscript([], { startedAt, makeId });
    expect(result.title).toBe(startedAt.toLocaleString());
    expect(result.markdown).toBe('');
    expect(result.checklist).toEqual([]);
  });

  it('translates its headings', () => {
    const result = structureTranscript([segment(0, 5_000, 'Al final vamos a usar Postgres.')], {
      startedAt,
      makeId,
      labels: {
        summary: 'Resumen',
        discussion: 'Puntos tratados',
        decisions: 'Decisiones',
        tasks: 'Tareas',
        questions: 'Preguntas abiertas',
        transcript: 'Transcripción',
      },
    });
    expect(result.markdown).toContain('## Decisiones');
    expect(result.markdown).not.toContain('## Decisions');
  });
});
