import { describe, expect, it } from 'vitest';

import {
  allItems,
  artifactProblems,
  canTransition,
  committed,
  emptyArtifact,
  filterItems,
  findItem,
  isEmptyArtifact,
  isGrounded,
  mapItems,
  mayCommit,
  nonEmptyChecklists,
  nonEmptySections,
  transitionItem,
  upsertItem,
  visibleItems,
} from '@/lib/artifact/artifact';
import {
  artifact,
  checklist,
  checklistItem,
  item,
  NOW,
  section,
  source,
} from '@/lib/artifact/__tests__/fixtures';

describe('status transitions', () => {
  it('lets a question be answered and asked again', () => {
    // The reason items carry ids at all: the same question, still the same
    // question, with whatever the user did to it intact.
    expect(canTransition('active', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'active')).toBe(true);
  });

  it('does not let an overturned decision come back', () => {
    // "We launch Friday", then "actually Monday". Presenting Friday as current
    // again is the bug; it is history, and history does not become news.
    expect(canTransition('active', 'superseded')).toBe(true);
    expect(canTransition('superseded', 'active')).toBe(false);
    expect(canTransition('superseded', 'resolved')).toBe(false);
  });

  it('treats removal as final', () => {
    // A correction the user watched happen may not silently undo itself.
    expect(canTransition('removed', 'active')).toBe(false);
    expect(canTransition('removed', 'resolved')).toBe(false);
    expect(canTransition('removed', 'removed')).toBe(true);
  });

  it('leaves an item alone rather than making a move it may not make', () => {
    // A model asking to revive a superseded decision should be ignored, not
    // crash a finalisation that would otherwise produce a good note.
    const gone = item('a', 'Lanzamos el viernes', { status: 'superseded' });
    expect(transitionItem(gone, 'active')).toEqual(gone);
    expect(transitionItem(gone, 'removed').status).toBe('removed');
  });
});

describe('visibility', () => {
  it('shows only what is still standing', () => {
    // `resolved` is the interesting exclusion: an answered question does not
    // belong in a list of open questions. Its ANSWER belongs in the notes, and
    // keeping the item rather than deleting it is what leaves the user's edit
    // pointing at something.
    const items = [
      item('a', 'activa'),
      item('b', 'resuelta', { status: 'resolved' }),
      item('c', 'reemplazada', { status: 'superseded' }),
      item('d', 'borrada', { status: 'removed' }),
    ];
    expect(visibleItems(items).map((visible) => visible.id)).toEqual(['a']);
  });
});

describe('upsertItem', () => {
  it('replaces in place, so a live note does not reorder on every slice', () => {
    const items = [item('a', 'uno'), item('b', 'dos'), item('c', 'tres')];
    const updated = upsertItem(items, item('b', 'dos, corregido'));
    expect(updated.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(updated[1].text).toBe('dos, corregido');
  });

  it('appends something genuinely new', () => {
    expect(upsertItem([item('a', 'uno')], item('b', 'dos')).map((entry) => entry.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('walking an artifact', () => {
  const full = artifact({
    title: item('t', 'Título'),
    sections: [section('s1', [item('n1', 'nota')])],
    checklists: [checklist('c1', [checklistItem('a1', 'acción')])],
    openQuestions: [item('q1', '¿Y el presupuesto?')],
  });

  it('reaches every item, title included', () => {
    // A caller walking these four shapes itself is a caller that forgets one,
    // which in practice means an edit surviving in the body and vanishing from
    // the checklist.
    expect(allItems(full).map((entry) => entry.id)).toEqual(['t', 'n1', 'a1', 'q1']);
  });

  it('finds an item wherever it lives', () => {
    expect(findItem(full, 'a1')?.text).toBe('acción');
    expect(findItem(full, 'nope')).toBeUndefined();
  });

  it('keeps a checklist item a checklist item through a map over text', () => {
    // The tick is not the mapper's business, and losing it here would lose it
    // everywhere, since this is the only walker.
    const shouted = mapItems(full, (entry) => ({ ...entry, text: entry.text.toUpperCase() }));
    expect(shouted.checklists[0].items[0]).toMatchObject({ text: 'ACCIÓN', checked: false });
    expect(shouted.title?.text).toBe('TÍTULO');
  });

  it('drops a section that filtering emptied', () => {
    const filtered = filterItems(full, (entry) => entry.id !== 'n1');
    expect(filtered.sections).toEqual([]);
    expect(filtered.checklists).toHaveLength(1);
  });
});

describe('grounding', () => {
  it('knows an item nobody could check against the recording', () => {
    expect(isGrounded(item('a', 'dicho'))).toBe(true);
    expect(isGrounded(item('b', 'inventado', { sources: [] }))).toBe(false);
  });

  it('complains about a derived item with no receipt', () => {
    // The trust rule made mechanical: knowledge Noted supplied itself has to
    // name the instruction that asked for it, or a reader cannot tell it from
    // something a speaker said.
    const derived = artifact({
      checklists: [
        checklist('c1', [
          checklistItem('a1', 'mozzarella', {
            origin: 'derived-from-instruction',
            sources: [],
          }),
        ]),
      ],
    });
    expect(artifactProblems(derived)).toEqual([
      'derived item without an authorising instruction: a1',
    ]);
  });

  it('complains about a transcript item with nothing behind it', () => {
    const ungrounded = artifact({ sections: [section('s', [item('n', 'según nadie', { sources: [] })])] });
    expect(artifactProblems(ungrounded)).toEqual(['transcript item with no source: n']);
  });

  it('complains about a repeated id, which would break every override', () => {
    const clashing = artifact({
      sections: [section('s', [item('same', 'uno'), item('same', 'dos')])],
    });
    expect(artifactProblems(clashing)).toContain('duplicate item id: same');
  });

  it('has nothing to say about an artifact that is fine', () => {
    const clean = artifact({
      sections: [section('s', [item('n', 'dicho en la reunión')])],
      checklists: [
        checklist('c', [
          checklistItem('a', 'harina', {
            origin: 'derived-from-instruction',
            sources: [],
            instructionSource: source(10_000, 12_000, 'seg-9'),
            derivationReason: 'pizza',
          }),
        ]),
      ],
    });
    expect(artifactProblems(clean)).toEqual([]);
  });
});

describe('revisions', () => {
  it('starts empty and knows it', () => {
    const fresh = emptyArtifact({
      id: 'a',
      noteId: 'n',
      captureId: 'c',
      stage: 'live',
      now: NOW,
    });
    expect(isEmptyArtifact(fresh)).toBe(true);
    expect(fresh.artifactRevision).toBe(0);
  });

  it('counts a commit', () => {
    const next = committed(artifact({ artifactRevision: 3 }), {
      transcriptRevision: 9,
      now: '2026-08-10T11:00:00.000Z',
    });
    expect(next.artifactRevision).toBe(4);
    expect(next.transcriptRevision).toBe(9);
    expect(next.updatedAt).toBe('2026-08-10T11:00:00.000Z');
  });

  it('is empty when everything in it was superseded', () => {
    const spent = artifact({
      sections: [section('s', [item('n', 'reemplazada', { status: 'superseded' })])],
    });
    expect(isEmptyArtifact(spent)).toBe(true);
  });
});

describe('mayCommit', () => {
  it('lets the first write through', () => {
    expect(mayCommit(null, { stage: 'live', transcriptRevision: 0 })).toBe(true);
  });

  it('refuses work built on an older transcript', () => {
    // The race in the current code: a restructure that started ten seconds ago
    // finishes last and puts the note back.
    const current = { stage: 'live' as const, transcriptRevision: 7 };
    expect(mayCommit(current, { stage: 'live', transcriptRevision: 6 })).toBe(false);
    expect(mayCommit(current, { stage: 'live', transcriptRevision: 7 })).toBe(true);
    expect(mayCommit(current, { stage: 'live', transcriptRevision: 8 })).toBe(true);
  });

  it('never lets a live pass land on the settled note, however fresh', () => {
    // Finalisation read the whole recording; a live pass never has. Revision
    // does not enter into it.
    const settled = { stage: 'final' as const, transcriptRevision: 3 };
    expect(mayCommit(settled, { stage: 'live', transcriptRevision: 99 })).toBe(false);
    expect(mayCommit(settled, { stage: 'final', transcriptRevision: 3 })).toBe(true);
  });
});

describe('empty sections', () => {
  it('omits a section whose items were all retired', () => {
    // "Decisions: none" reads as a finding about the meeting; no heading reads
    // as what it is.
    const spent = artifact({
      sections: [
        section('s1', [item('a', 'sigue', {})]),
        section('s2', [item('b', 'retirada', { status: 'removed' })]),
      ],
      checklists: [checklist('c1', [checklistItem('x', 'hecha', { status: 'superseded' })])],
    });
    expect(nonEmptySections(spent).map((entry) => entry.id)).toEqual(['s1']);
    expect(nonEmptyChecklists(spent)).toEqual([]);
  });
});
