import { describe, expect, it } from 'vitest';

import { composeNote } from '@/lib/artifact/compose';
import { legacyArtifact, legacyArtifactId, legacyItemId } from '@/lib/artifact/legacy';
import { renderArtifact } from '@/lib/artifact/render';
import { composeNoteBody } from '@/lib/notes/generated-body';
import { NOW, unitsOf } from '@/lib/artifact/__tests__/fixtures';

/** A real generated block, of the shape the old path wrote. */
const GENERATED = [
  '- PostgreSQL será la única base de datos',
  '- La migración terminó el viernes',
  '',
  '## Open questions',
  '',
  '- ¿Quién firma el contrato?',
].join('\n');

const INPUT = { noteId: 'note_1', captureId: 'cap_1', generatedBody: GENERATED, now: NOW };

describe('legacyArtifact', () => {
  it('is nothing for a note nobody recorded into', () => {
    // Otherwise every hand-typed note in the database gets a row it does not
    // need, on a migration that is supposed to be free.
    expect(legacyArtifact({ ...INPUT, generatedBody: '' })).toBeNull();
    expect(legacyArtifact({ ...INPUT, generatedBody: '   \n\n ' })).toBeNull();
  });

  it('derives its ids from the note, so running the migration twice is free', () => {
    const first = legacyArtifact(INPUT);
    const second = legacyArtifact({ ...INPUT, now: '2027-01-01T00:00:00.000Z' });
    expect(first?.id).toBe(legacyArtifactId('note_1'));
    expect(first?.id).toBe(second?.id);
    expect(first).not.toBeNull();
    if (!first) return;
    expect(unitsOf(first.sections[0])[0].id).toBe(legacyItemId('note_1'));
  });

  it('claims no evidence it does not have', () => {
    // The old path never recorded which part of the recording anything came
    // from. A source range here would be invented.
    const migrated = legacyArtifact(INPUT);
    expect(migrated).not.toBeNull();
    if (!migrated) return;
    expect(unitsOf(migrated.sections[0])[0].sources).toEqual([]);
    expect(unitsOf(migrated.sections[0])[0].origin).toBe('legacy');
  });

  it('is settled, so no live pass can overwrite it', () => {
    // The recording it came from may not even have a transcript on this device
    // any more; a live writer would replace it with less.
    expect(legacyArtifact(INPUT)?.stage).toBe('final');
  });
});

describe('migrating loses nothing', () => {
  it('renders the old block back byte for byte', () => {
    const migrated = legacyArtifact(INPUT);
    expect(migrated).not.toBeNull();
    if (!migrated) return;
    expect(renderArtifact(migrated)).toBe(GENERATED);
  });

  it('composes the same note the old code composed', () => {
    // The whole migration promise in one assertion: the same user text, the same
    // generated text, the same body — through the new path.
    const userBody = 'Mis notas de la reunión';
    const migrated = legacyArtifact(INPUT);
    expect(migrated).not.toBeNull();
    if (!migrated) return;

    const composed = composeNote({
      user: { title: '', body: userBody, checklist: [] },
      final: migrated,
      fallbackTitle: 'da igual',
    });
    expect(composed.body).toBe(composeNoteBody(userBody, GENERATED));
    expect(composed.generatedBody).toBe(GENERATED);
  });

  it('composes the same note when the user typed nothing', () => {
    const migrated = legacyArtifact(INPUT);
    expect(migrated).not.toBeNull();
    if (!migrated) return;

    const composed = composeNote({
      user: { title: '', body: '', checklist: [] },
      final: migrated,
      fallbackTitle: 'da igual',
    });
    expect(composed.body).toBe(composeNoteBody('', GENERATED));
  });
});
