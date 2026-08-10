/**
 * The note as a document rather than a list.
 *
 * #59 in one sentence: `GeneratedSection` held only `items` and the renderer
 * prefixed every one with `- `, so the note a model produced could only ever be a
 * bullet summary however well it understood the recording. No prompt defeats a
 * dash added afterwards.
 *
 * These cover the shapes a real note needs — prose, two kinds of list, a
 * quotation, who was speaking — and the migration that keeps notes written before
 * any of it existed.
 */

import { describe, expect, it } from 'vitest';

import { allItems, blockUnits, nonEmptySections } from '@/lib/artifact/artifact';
import { renderArtifact } from '@/lib/artifact/render';
import { type GeneratedBlock } from '@noted/shared-types';
import { DEFAULT_ARTIFACT_LABELS } from '@/lib/artifact/types';
import { artifact, item, paragraph, prose, source } from '@/lib/artifact/__tests__/fixtures';

function list(
  id: string,
  kind: 'bullet-list' | 'numbered-list',
  texts: string[],
): GeneratedBlock {
  return {
    id,
    kind,
    status: 'active',
    origin: 'transcript',
    sources: [],
    items: texts.map((text, index) => ({
      id: `${id}.${String(index)}`,
      text,
      status: 'active',
      origin: 'transcript',
      sources: [source(0, 1_000, `${id}-seg`)],
    })),
  };
}

describe('prose', () => {
  it('is written as a paragraph, with no bullet in front of it', () => {
    const rendered = renderArtifact(
      artifact({ sections: [prose('s', [paragraph('p1', 'El ministerio consultó a expertos.')])] }),
    );
    expect(rendered).toBe('El ministerio consultó a expertos.');
    expect(rendered.startsWith('- ')).toBe(false);
  });

  it('keeps two paragraphs as two paragraphs', () => {
    // Welded together they become one argument the speaker never made.
    const rendered = renderArtifact(
      artifact({
        sections: [prose('s', [paragraph('p1', 'Primero.'), paragraph('p2', 'Segundo.')])],
      }),
    );
    expect(rendered).toBe('Primero.\n\nSegundo.');
  });

  it('puts a heading over a section that has one', () => {
    const rendered = renderArtifact(
      artifact({
        sections: [
          prose('s', [paragraph('p1', 'Cómo entró la IA en la agenda.')], {
            heading: 'La agenda del ministerio',
          }),
        ],
      }),
    );
    expect(rendered).toBe('## La agenda del ministerio\n\nCómo entró la IA en la agenda.');
  });
});

describe('mixing prose and a list in one section', () => {
  it('keeps them apart', () => {
    // The case the old domain could not express at all: an explanation followed
    // by the three things it enumerates.
    const rendered = renderArtifact(
      artifact({
        sections: [
          prose(
            's',
            [
              paragraph('p1', 'El ministerio consultó a tres grupos.'),
              list('l1', 'bullet-list', ['neurocientíficos', 'empresas tecnológicas']),
            ],
            { heading: 'Consultas' },
          ),
        ],
      }),
    );
    expect(rendered).toBe(
      '## Consultas\n\nEl ministerio consultó a tres grupos.\n\n- neurocientíficos\n- empresas tecnológicas',
    );
  });
});

describe('an ordered list', () => {
  it('is numbered, because the order is the content', () => {
    const rendered = renderArtifact(
      artifact({ sections: [prose('s', [list('l1', 'numbered-list', ['Primero', 'Segundo'])])] }),
    );
    expect(rendered).toBe('1. Primero\n2. Segundo');
  });
});

describe('a quotation', () => {
  const quote: GeneratedBlock = {
    id: 'q1',
    kind: 'quote',
    text: 'I became a minister in April of 2023.',
    attribution: 'the speaker',
    status: 'active',
    origin: 'transcript',
    sources: [source(0, 5_000, 'seg-1')],
  };

  it('is marked as somebody else speaking', () => {
    // The one place first person survives into the note, because a quotation is
    // explicitly not the note talking.
    expect(renderArtifact(artifact({ sections: [prose('s', [quote])] }))).toBe(
      '> I became a minister in April of 2023.\n>\n> — the speaker',
    );
  });

  it('keeps the attribution inside the quotation', () => {
    // A line after the block reads as the note speaking, which is what a quote
    // exists to avoid.
    const rendered = renderArtifact(artifact({ sections: [prose('s', [quote])] }));
    expect(rendered.split('\n').every((line) => line.startsWith('>'))).toBe(true);
  });
});

describe('who was speaking', () => {
  it('is stated when the recording states it', () => {
    const rendered = renderArtifact(
      artifact({
        people: [{ id: 'p', role: 'Education minister', sources: [source(0, 1_000, 'seg-1')] }],
        sections: [prose('s', [paragraph('p1', 'Algo.')])],
      }),
    );
    expect(rendered.startsWith('**Speaker:** Education minister')).toBe(true);
  });

  it('says nothing at all when the recording does not', () => {
    // The absence of a name is information. Inventing one is the failure this
    // whole field exists to make visible.
    const rendered = renderArtifact(
      artifact({ people: [], sections: [prose('s', [paragraph('p1', 'Algo.')])] }),
    );
    expect(rendered).toBe('Algo.');
  });

  it('does not print an empty person', () => {
    const rendered = renderArtifact(
      artifact({
        people: [{ id: 'p', sources: [] }],
        sections: [prose('s', [paragraph('p1', 'Algo.')])],
      }),
    );
    expect(rendered).toBe('Algo.');
  });
});

describe('open questions', () => {
  it('are a separate list only when something is genuinely open', () => {
    const withOpen = renderArtifact(
      artifact({
        sections: [prose('s', [paragraph('p1', 'Algo.')])],
        openQuestions: [item('q', '¿Quién firma?')],
      }),
    );
    expect(withOpen).toContain(`## ${DEFAULT_ARTIFACT_LABELS.questions}`);

    const without = renderArtifact(artifact({ sections: [prose('s', [paragraph('p1', 'Algo.')])] }));
    expect(without).not.toContain(DEFAULT_ARTIFACT_LABELS.questions);
  });
});

describe('the checklist', () => {
  it('is still not in the prose body', () => {
    // Two copies of a task disagree the moment either is ticked.
    const rendered = renderArtifact(
      artifact({
        sections: [prose('s', [paragraph('p1', 'Algo.')])],
        checklists: [
          {
            id: 'c',
            kind: 'actions',
            items: [
              {
                id: 'a1',
                text: 'Llamar al banco',
                checked: false,
                status: 'active',
                origin: 'transcript',
                sources: [],
              },
            ],
          },
        ],
      }),
    );
    expect(rendered).not.toContain('Llamar al banco');
  });
});

describe('provenance at the smallest editable unit', () => {
  it('reaches a paragraph and every line of a list', () => {
    const built = artifact({
      sections: [
        prose('s', [paragraph('p1', 'Prosa.'), list('l1', 'bullet-list', ['uno', 'dos'])]),
      ],
    });
    expect(allItems(built).map((unit) => unit.id)).toEqual(['p1', 'l1.0', 'l1.1']);
  });

  it('treats a list as a container and its lines as the units', () => {
    const bullets = list('l1', 'bullet-list', ['uno', 'dos']);
    expect(blockUnits(bullets).map((unit) => unit.id)).toEqual(['l1.0', 'l1.1']);
    expect(blockUnits(paragraph('p1', 'Prosa.'))).toHaveLength(1);
  });
});

describe('retiring things', () => {
  it('drops a paragraph a later pass superseded, keeping the rest', () => {
    const built = artifact({
      sections: [
        prose('s', [
          paragraph('p1', 'Vigente.'),
          paragraph('p2', 'Reemplazada.', { status: 'superseded' }),
        ]),
      ],
    });
    expect(renderArtifact(built)).toBe('Vigente.');
  });

  it('drops a list whose every line was retired, and the section with it', () => {
    const spent: GeneratedBlock = {
      ...list('l1', 'bullet-list', ['uno']),
      kind: 'bullet-list',
      items: [
        {
          id: 'l1.0',
          text: 'uno',
          status: 'removed',
          origin: 'transcript',
          sources: [],
        },
      ],
    };
    const built = artifact({ sections: [prose('s', [spent])] });
    expect(nonEmptySections(built)).toEqual([]);
    expect(renderArtifact(built)).toBe('');
  });
});
