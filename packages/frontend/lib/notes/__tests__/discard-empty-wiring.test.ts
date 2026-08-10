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

const EDITOR = readFileSync(
  join(import.meta.dirname, '../../..', 'app/n/[id].tsx'),
  'utf8',
);

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('the editor', () => {
  it('is the file this thinks it is', () => {
    expect(EDITOR).toContain('export default function NoteEditorScreen');
  });

  it('asks one question about emptiness, in both places', () => {
    // Two copies of "is this empty" drift, and the drift shows up as a note that
    // could be created but not kept — or worse, kept but not created.
    expect(occurrences(EDITOR, 'isEmptyNote(')).toBe(2);
  });

  it('throws the note away when it is left empty', () => {
    expect(EDITOR).toContain('deleteNote.mutate(id)');
  });

  it('will not delete a note it has not loaded yet', () => {
    // `base` is null until the note arrives and the draft starts blank, so
    // without this, opening an existing note and closing it before it loads
    // reads as "the user emptied this".
    expect(EDITOR).toMatch(/if \(!id \|\| !base\) return;/);
  });

  it('compares the user half of the body, not the composed one', () => {
    // The composed body carries whatever a recording wrote. Measuring emptiness
    // against it would keep every blank note that ever had a recorder open on it
    // — and measuring the raw draft body would be measuring the app's own output
    // as if the user had typed it.
    expect(EDITOR).toContain('userBody: userBodyOf(next.body, next.generatedBody)');
  });
});
