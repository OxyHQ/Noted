import { describe, expect, it } from 'vitest';

import { headingFor, renderArtifact } from '@/lib/artifact/render';
import { DEFAULT_ARTIFACT_LABELS } from '@/lib/artifact/types';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  paragraph,
  prose,
  section,
} from '@/lib/artifact/__tests__/fixtures';

describe('headings', () => {
  it('gives the note itself none', () => {
    // "## Summary" over the only content on the page is a label for something
    // that needs no labelling.
    expect(headingFor(section('s', []), DEFAULT_ARTIFACT_LABELS)).toBeNull();
  });

  it('names the sections that are genuinely a part of something', () => {
    expect(headingFor(section('s', [], { kind: 'decisions' }), DEFAULT_ARTIFACT_LABELS)).toBe(
      'Decisions',
    );
    expect(headingFor(section('s', [], { kind: 'concepts' }), DEFAULT_ARTIFACT_LABELS)).toBe(
      'Concepts',
    );
  });

  it('lets a profile choose its own', () => {
    expect(
      headingFor(section('s', [], { kind: 'notes', heading: 'Lo que se dijo' }), DEFAULT_ARTIFACT_LABELS),
    ).toBe('Lo que se dijo');
  });
});

describe('renderArtifact', () => {
  it('writes the notes as the note, with no heading over them', () => {
    const rendered = renderArtifact(
      artifact({ sections: [section('s', [item('a', 'PostgreSQL será la única base'), item('b', 'La migración terminó')])] }),
    );
    expect(rendered).toBe('- PostgreSQL será la única base\n- La migración terminó');
  });

  it('separates open questions only when there are some', () => {
    const withQuestions = renderArtifact(
      artifact({
        sections: [section('s', [item('a', 'Un punto')])],
        openQuestions: [item('q', '¿Quién firma?')],
      }),
    );
    expect(withQuestions).toBe('- Un punto\n\n## Open questions\n\n- ¿Quién firma?');

    const without = renderArtifact(artifact({ sections: [section('s', [item('a', 'Un punto')])] }));
    expect(without).toBe('- Un punto');
  });

  it('leaves the checklist out of the body', () => {
    // A task written into the body as well as into the checklist is two copies
    // of one task, and they disagree the moment either is ticked.
    const rendered = renderArtifact(
      artifact({
        sections: [section('s', [item('a', 'Un punto')])],
        checklists: [checklist('c', [checklistItem('x', 'Llamar al banco')])],
      }),
    );
    expect(rendered).toBe('- Un punto');
    expect(rendered).not.toContain('Llamar al banco');
  });

  it('leaves out an item later speech retired', () => {
    const rendered = renderArtifact(
      artifact({
        sections: [
          section('s', [
            item('a', 'Lanzamos el lunes'),
            item('b', 'Lanzamos el viernes', { status: 'superseded' }),
          ]),
        ],
      }),
    );
    expect(rendered).toBe('- Lanzamos el lunes');
  });

  it('drops a section that has nothing visible left', () => {
    const rendered = renderArtifact(
      artifact({
        sections: [
          section('s1', [item('a', 'Sigue')]),
          section('s2', [item('b', 'Fuera', { status: 'removed' })], { kind: 'decisions' }),
        ],
      }),
    );
    expect(rendered).toBe('- Sigue');
  });

  it('gives back a legacy block exactly as it was stored', () => {
    // The migration promise: an old note reads exactly as it did. Adding a
    // bullet here would rewrite somebody's note during an upgrade.
    const old = '## Open questions\n\n- ¿Está leyendo todo internet?';
    const rendered = renderArtifact(
      artifact({
        // The shape `legacy.ts` actually writes: one paragraph carrying the whole
        // old block, not a list line.
        sections: [
          prose('s', [paragraph('legacy', old, { origin: 'legacy', sources: [] })], {
            kind: 'custom',
          }),
        ],
      }),
    );
    expect(rendered).toBe(old);
  });

  it('is empty for an artifact with nothing in it', () => {
    expect(renderArtifact(artifact())).toBe('');
  });

  it('takes its headings from the caller, so the note can be in the user language', () => {
    const rendered = renderArtifact(
      artifact({ openQuestions: [item('q', '¿Quién firma?')] }),
      { ...DEFAULT_ARTIFACT_LABELS, questions: 'Preguntas abiertas' },
    );
    expect(rendered).toBe('## Preguntas abiertas\n\n- ¿Quién firma?');
  });
});
