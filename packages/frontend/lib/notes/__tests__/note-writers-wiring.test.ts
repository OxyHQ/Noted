/**
 * That every writer of a note body actually goes through the ownership rules.
 *
 * The three writers reach SQLite, expo-router or React, so none of them can run
 * in this suite — and the rules they have to follow live in `lib/notes/blocks.ts`
 * and `draft-sync.ts`, which are tested thoroughly and in isolation. That leaves
 * exactly one gap, and it is the gap both bugs fell through: the pure module can
 * be perfect while nothing calls it.
 *
 * Proven, not assumed. Each assertion below was mutation-tested by putting the
 * old code back and confirming that this file is the only one that goes red.
 *
 * These are source checks, which is crude, and they are scoped to named files
 * and named symbols rather than pretending to be a general rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;

const RESTRUCTURE = readFileSync(join(HERE, '../../capture/restructure.ts'), 'utf8');
const REPO = readFileSync(join(HERE, '../../db/notes-repo.ts'), 'utf8');
const EDITOR = readFileSync(join(HERE, '../../../app/n/[id].tsx'), 'utf8');

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('the recorder', () => {
  it('reads a file that actually contains the writers', () => {
    // Without this, a renamed or moved file makes every assertion below pass by
    // finding nothing at all.
    expect(RESTRUCTURE).toContain('export async function restructureNote');
    expect(RESTRUCTURE).toContain('export async function enhanceNote');
  });

  it('writes the note in exactly one place, for both passes', () => {
    // The two passes used to be two write paths, and a rule enforced in one copy
    // is not enforced. They share one `commit`: a second `updateNote` is a second
    // opinion about who owns what.
    expect(occurrences(RESTRUCTURE, 'updateNote(')).toBe(1);
  });

  it('sends only its own blocks, and puts none together itself', () => {
    // The duplication bug: the generated text was written as the whole note,
    // then read back next slice as if the user had typed it, and appended to.
    // The recorder hands over what it renders (`rendered`) and the store
    // replaces its previous blocks with them, against the row as it stands at
    // write time — never a whole block list composed from a stale read.
    expect(RESTRUCTURE).toContain('rendered: composed.rendered');
    expect(RESTRUCTURE).not.toMatch(/\bblocks:/);
    expect(RESTRUCTURE).not.toContain('withGenerated(');
  });

  it('never shows a writer the note it wrote itself', () => {
    // The model is handed what the USER wrote (`userAuthoredPart`, which leaves
    // out the recorder's blocks), never the whole note: shown its own previous
    // output it summarises itself.
    expect(RESTRUCTURE).toContain('body: context.userBody');
    expect(RESTRUCTURE).toContain('userAuthoredPart(');
    expect(RESTRUCTURE).not.toMatch(/body:\s*context\.note\./);
  });
});

describe('the store', () => {
  it('reads a file that actually contains the writes', () => {
    expect(REPO).toContain('export async function createNote');
    expect(REPO).toContain('export async function updateNote');
  });

  it('is the one place content is put together', () => {
    // Both writes hand their part to the assembler; a write that stopped doing
    // so would have to merge somewhere else, and the single path would be two.
    expect(occurrences(REPO, 'nextContent(')).toBe(3);
    expect(REPO).toContain('mergeBlocks(');
    expect(REPO).toContain('withGenerated(');
  });

  it('compares the stored blocks before writing, so a stale merge is redone', () => {
    expect(REPO).toContain('AND blocks_json = ? AND generated_json = ?');
  });
});

describe('the open editor', () => {
  it('reads a file that actually contains the editor', () => {
    expect(EDITOR).toContain('export default function NoteEditorScreen');
  });

  it('sends its blocks as an edit on what it started from', () => {
    // The reported bug: the editor persisted the body in full, so a keystroke
    // in an open note wrote back the note as it was when it opened and erased
    // everything the recorder had added since.
    expect(EDITOR).toContain('editorPatch(');
    expect(EDITOR).not.toMatch(/patch:\s*\{\s*blocks:/);
  });

  it('follows the store instead of hydrating once', () => {
    // `hydrated` was a boolean that never went back to false, so nothing
    // written after the note opened ever reached the draft — which is why the
    // card and the editor showed different text for the same note.
    expect(EDITOR).toContain('reconcileDraft(');
    expect(EDITOR).not.toContain('setHydrated');
  });
});
