import { describe, expect, it } from 'vitest';

import { composeNote, preferredArtifact, type UserContent } from '@/lib/artifact/compose';
import { emptyOverride, type UserItemOverride } from '@/lib/artifact/ownership';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  section,
} from '@/lib/artifact/__tests__/fixtures';

const FALLBACK = '10/08/2026, 10:00';

function user(over: Partial<UserContent> = {}): UserContent {
  return { title: '', body: '', checklist: [], ...over };
}

function override(entry: Partial<UserItemOverride> & { itemId: string }): UserItemOverride {
  return { ...emptyOverride(entry.itemId), ...entry };
}

const LIVE = artifact({
  stage: 'live',
  title: item('t-live', 'Reunión de producto'),
  sections: [section('s', [item('n1', 'Provisional')])],
});

const FINAL = artifact({
  id: 'art_final',
  stage: 'final',
  title: item('t-final', 'Migración a PostgreSQL'),
  sections: [section('s', [item('n2', 'PostgreSQL será la única base')])],
});

describe('which artifact is shown', () => {
  it('prefers the settled one', () => {
    // Not a fallback relationship: the finaliser read the whole recording and a
    // live pass never did, so once it exists the provisional one is an old draft.
    expect(preferredArtifact({ user: user(), live: LIVE, final: FINAL, fallbackTitle: FALLBACK })?.id).toBe(
      'art_final',
    );
    expect(preferredArtifact({ user: user(), live: LIVE, fallbackTitle: FALLBACK })?.id).toBe('art_1');
    expect(preferredArtifact({ user: user(), fallbackTitle: FALLBACK })).toBeNull();
  });
});

describe('title', () => {
  it('is the user title whenever they gave one', () => {
    expect(
      composeNote({ user: user({ title: 'Mi título' }), final: FINAL, fallbackTitle: FALLBACK }).title,
    ).toBe('Mi título');
  });

  it('prefers the settled title over the provisional one', () => {
    // The early automatic title is the one the old code could not improve later,
    // because nothing recorded that the app had written it.
    expect(composeNote({ user: user(), live: LIVE, final: FINAL, fallbackTitle: FALLBACK }).title).toBe(
      'Migración a PostgreSQL',
    );
  });

  it('falls back to the provisional title while the recording is still running', () => {
    expect(composeNote({ user: user(), live: LIVE, fallbackTitle: FALLBACK }).title).toBe(
      'Reunión de producto',
    );
  });

  it('names the note by its date when nobody titled it', () => {
    expect(composeNote({ user: user(), fallbackTitle: FALLBACK }).title).toBe(FALLBACK);
  });

  it('respects a title the user rewrote or deleted', () => {
    expect(
      composeNote({
        user: user(),
        final: FINAL,
        overrides: [override({ itemId: 't-final', text: 'Mi versión' })],
        fallbackTitle: FALLBACK,
      }).title,
    ).toBe('Mi versión');

    expect(
      composeNote({
        user: user(),
        live: LIVE,
        final: FINAL,
        overrides: [override({ itemId: 't-final', removed: true })],
        fallbackTitle: FALLBACK,
      }).title,
    ).toBe('Reunión de producto');
  });
});

describe('body', () => {
  it('puts what the user typed first, verbatim', () => {
    // They were in the room and chose to type that; burying it under generated
    // text is the app talking over them.
    const composed = composeNote({
      user: user({ body: 'Mis notas\n\ncon dos párrafos' }),
      final: FINAL,
      fallbackTitle: FALLBACK,
    });
    expect(composed.body).toBe(
      'Mis notas\n\ncon dos párrafos\n\n- PostgreSQL será la única base',
    );
  });

  it('hands back the generated half on its own, for the store to remember', () => {
    const composed = composeNote({
      user: user({ body: 'Mis notas' }),
      final: FINAL,
      fallbackTitle: FALLBACK,
    });
    expect(composed.generatedBody).toBe('- PostgreSQL será la única base');
    expect(composed.body.endsWith(composed.generatedBody)).toBe(true);
  });

  it('is only the user when nothing was generated', () => {
    expect(composeNote({ user: user({ body: 'Solo lo mío' }), fallbackTitle: FALLBACK }).body).toBe(
      'Solo lo mío',
    );
  });

  it('is only the generated half when the user wrote nothing', () => {
    expect(composeNote({ user: user(), final: FINAL, fallbackTitle: FALLBACK }).body).toBe(
      '- PostgreSQL será la única base',
    );
  });
});

describe('checklist', () => {
  const withActions = artifact({
    stage: 'final',
    checklists: [
      checklist('c', [
        checklistItem('a1', 'Llamar al banco'),
        checklistItem('a2', 'Preparar el presupuesto'),
      ]),
    ],
  });

  it('keeps the user items first and in their order', () => {
    const composed = composeNote({
      user: user({ checklist: [{ id: 'u1', text: 'Comprar pan', checked: true }] }),
      final: withActions,
      fallbackTitle: FALLBACK,
    });
    expect(composed.checklist.map((entry) => entry.id)).toEqual(['u1', 'a1', 'a2']);
    expect(composed.checklist[0].checked).toBe(true);
  });

  it('does not add a task the user already wrote down', () => {
    // Punctuated differently by the recogniser is still the same task, which is
    // why this compares by similarity and not by string equality.
    const composed = composeNote({
      user: user({ checklist: [{ id: 'u1', text: 'llamar al banco.', checked: false }] }),
      final: withActions,
      fallbackTitle: FALLBACK,
    });
    expect(composed.checklist.map((entry) => entry.text)).toEqual([
      'llamar al banco.',
      'Preparar el presupuesto',
    ]);
  });

  it('carries the quantity into the line the user reads', () => {
    const shopping = artifact({
      stage: 'final',
      checklists: [
        checklist('c', [checklistItem('s1', 'pollo', { quantity: '2 kg' })], { kind: 'shopping' }),
      ],
    });
    expect(composeNote({ user: user(), final: shopping, fallbackTitle: FALLBACK }).checklist).toEqual(
      [{ id: 's1', text: '2 kg pollo', checked: false }],
    );
  });

  it('keeps the tick the user set through a regeneration', () => {
    const composed = composeNote({
      user: user(),
      final: withActions,
      overrides: [override({ itemId: 'a1', checked: true })],
      fallbackTitle: FALLBACK,
    });
    expect(composed.checklist[0]).toEqual({ id: 'a1', text: 'Llamar al banco', checked: true });
  });

  it('leaves out an item the user deleted', () => {
    const composed = composeNote({
      user: user(),
      final: withActions,
      overrides: [override({ itemId: 'a2', removed: true })],
      fallbackTitle: FALLBACK,
    });
    expect(composed.checklist.map((entry) => entry.id)).toEqual(['a1']);
  });
});

describe('a note nobody recorded', () => {
  it('composes to exactly what the user wrote', () => {
    const composed = composeNote({
      user: user({ title: 'Lista', body: 'Texto', checklist: [{ id: 'u', text: 'x', checked: false }] }),
      fallbackTitle: FALLBACK,
    });
    expect(composed).toEqual({
      title: 'Lista',
      body: 'Texto',
      generatedBody: '',
      checklist: [{ id: 'u', text: 'x', checked: false }],
    });
  });
});
