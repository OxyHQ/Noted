import { describe, expect, it } from 'vitest';

import { composeNote, preferredArtifact, type UserContent } from '@/lib/artifact/compose';
import type { UserItemOverride } from '@noted/shared-types';
import { emptyOverride } from '@/lib/artifact/ownership';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  section,
} from '@/lib/artifact/__tests__/fixtures';

const FALLBACK = '10/08/2026, 10:00';

function user(over: Partial<UserContent> = {}): UserContent {
  return { title: '', todos: [], ...over };
}

/** The rendered blocks as `[key, type, text, checked?]`, which is what a reader sees. */
const shown = (rendered: ReturnType<typeof composeNote>['rendered']) =>
  rendered.map((block) => [
    block.key,
    block.type,
    block.content.text,
    ...(block.type === 'todo' ? [block.content.checked] : []),
  ]);

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
    expect(
      preferredArtifact({ user: user(), live: LIVE, final: FINAL, fallbackTitle: FALLBACK })?.id,
    ).toBe('art_final');
    expect(preferredArtifact({ user: user(), live: LIVE, fallbackTitle: FALLBACK })?.id).toBe(
      'art_1',
    );
    expect(preferredArtifact({ user: user(), fallbackTitle: FALLBACK })).toBeNull();
  });
});

describe('title', () => {
  it('is the user title whenever they gave one', () => {
    expect(
      composeNote({ user: user({ title: 'Mi título' }), final: FINAL, fallbackTitle: FALLBACK })
        .title,
    ).toBe('Mi título');
  });

  it('prefers the settled title over the provisional one', () => {
    // The early automatic title is the one the old code could not improve later,
    // because nothing recorded that the app had written it.
    expect(
      composeNote({ user: user(), live: LIVE, final: FINAL, fallbackTitle: FALLBACK }).title,
    ).toBe('Migración a PostgreSQL');
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

describe('rendered blocks', () => {
  it('are the artifact alone: the store puts them after what the user wrote', () => {
    // Composing never touches the user's blocks; the store keeps them first
    // (`withGenerated`), which is what stops the app talking over them.
    const composed = composeNote({ user: user(), final: FINAL, fallbackTitle: FALLBACK });
    expect(shown(composed.rendered)).toEqual([
      ['n2', 'bulleted_list_item', 'PostgreSQL será la única base'],
    ]);
  });

  it('are keyed by what they render, so a rebuild finds the same block again', () => {
    const first = composeNote({ user: user(), final: FINAL, fallbackTitle: FALLBACK });
    const again = composeNote({ user: user(), final: FINAL, fallbackTitle: FALLBACK });
    expect(again.rendered.map((block) => block.key)).toEqual(
      first.rendered.map((block) => block.key),
    );
  });

  it('are nothing when nothing was generated', () => {
    expect(composeNote({ user: user(), fallbackTitle: FALLBACK }).rendered).toEqual([]);
  });
});

describe('tasks', () => {
  const withActions = artifact({
    stage: 'final',
    checklists: [
      checklist('c', [
        checklistItem('a1', 'Llamar al banco'),
        checklistItem('a2', 'Preparar el presupuesto'),
      ]),
    ],
  });

  it('are todo blocks after the rest, in the artifact’s order', () => {
    const composed = composeNote({ user: user(), final: withActions, fallbackTitle: FALLBACK });
    expect(shown(composed.rendered)).toEqual([
      ['a1', 'todo', 'Llamar al banco', false],
      ['a2', 'todo', 'Preparar el presupuesto', false],
    ]);
  });

  it('do not add a task the user already wrote down', () => {
    // Punctuated differently by the recogniser is still the same task, which is
    // why this compares by similarity and not by string equality.
    const composed = composeNote({
      user: user({ todos: ['llamar al banco.'] }),
      final: withActions,
      fallbackTitle: FALLBACK,
    });
    expect(composed.rendered.map((block) => block.content.text)).toEqual([
      'Preparar el presupuesto',
    ]);
  });

  it('carry the quantity into the line the user reads', () => {
    const shopping = artifact({
      stage: 'final',
      checklists: [
        checklist('c', [checklistItem('s1', 'pollo', { quantity: '2 kg' })], { kind: 'shopping' }),
      ],
    });
    expect(
      shown(composeNote({ user: user(), final: shopping, fallbackTitle: FALLBACK }).rendered),
    ).toEqual([['s1', 'todo', '2 kg pollo', false]]);
  });

  it('keep the tick the user set through a regeneration', () => {
    const composed = composeNote({
      user: user(),
      final: withActions,
      overrides: [override({ itemId: 'a1', checked: true })],
      fallbackTitle: FALLBACK,
    });
    expect(shown(composed.rendered)[0]).toEqual(['a1', 'todo', 'Llamar al banco', true]);
  });

  it('leave out an item the user deleted', () => {
    const composed = composeNote({
      user: user(),
      final: withActions,
      overrides: [override({ itemId: 'a2', removed: true })],
      fallbackTitle: FALLBACK,
    });
    expect(composed.rendered.map((block) => block.key)).toEqual(['a1']);
  });
});

describe('a note nobody recorded', () => {
  it('composes to its title and nothing of the app’s', () => {
    const composed = composeNote({
      user: user({ title: 'Lista', todos: ['x'] }),
      fallbackTitle: FALLBACK,
    });
    expect(composed).toEqual({ title: 'Lista', rendered: [] });
  });
});
