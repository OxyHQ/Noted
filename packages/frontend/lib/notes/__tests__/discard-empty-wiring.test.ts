/**
 * That the editor actually discards an empty note, and only an empty one.
 *
 * `isEmptyNote` is pure and tested; the editor is React and unreachable from this
 * suite. The gap between them is where the two dangerous mistakes live: never
 * calling it, and calling it before the note has loaded — which would delete a
 * note the user opened and closed without ever seeing.
 *
 * A source check, scoped to one file and named symbols. Mutation-tested by
 * removing each guard and confirming this file is what goes red.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const EDITOR = readFileSync(join(import.meta.dirname, '../../..', 'app/n/[id].tsx'), 'utf8');

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('the editor', () => {
  it('is the file this thinks it is', () => {
    expect(EDITOR).toContain('export default function NoteEditorScreen');
  });

  it('uses the removal guard from the same navigation context as Expo Router', () => {
    // SDK 56 owns its navigation context. The upstream hook typechecks but
    // throws "Could not find a navigation object" when opening a real editor.
    // Quote-agnostic: the formatter owns quote style, and a needle spelled with
    // one quote kind makes the negative check pass vacuously on the other.
    expect(EDITOR).toMatch(
      /import \{ usePreventRemove \} from ['"]expo-router\/react-navigation['"]/,
    );
    expect(EDITOR).not.toMatch(/from ['"]@react-navigation\/native['"]/);
  });

  it('asks one question about emptiness, in both places', () => {
    // Two copies of "is this empty" drift, and the drift shows up as a note that
    // could be created but not kept — or worse, kept but not created.
    expect(occurrences(EDITOR, 'isEmptyNote(')).toBe(2);
  });

  it('throws the note away when it is left empty', () => {
    expect(EDITOR).toContain('await deleteNote.mutateAsync(id)');
  });

  it('will not delete a note it has not loaded yet', () => {
    // `base` is null until the note arrives and the draft starts blank, so
    // without this, opening an existing note and closing it before it loads
    // reads as "the user emptied this".
    expect(EDITOR).toContain('usePreventRemove(isNew || base !== null');
  });

  it('measures the note itself, which counts the recorder’s blocks as content', () => {
    // A note the recorder has written into is not empty, however little the
    // user typed: `isEmptyNote` reads the recorder's map for exactly that.
    expect(EDITOR).toContain('isEmptyNote(next)');
  });
});
