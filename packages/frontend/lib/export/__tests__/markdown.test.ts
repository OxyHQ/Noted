import { describe, expect, it } from 'vitest';

import type { LocalNote as Note } from '@/lib/db/notes-repo';
import { noteFilename, noteToMarkdown } from '@/lib/export/markdown';
import type { NoteBlock } from '@/lib/notes/blocks';

const block = (
  id: string,
  type: NoteBlock['type'],
  content: Record<string, unknown>,
  order: number,
): NoteBlock => ({
  id,
  parentBlockId: null,
  type,
  content,
  order,
});
const DECISIONS: NoteBlock[] = [
  block('h', 'heading_2', { text: 'Decisions' }, 0),
  block('b', 'bulleted_list_item', { text: 'Congelar contrataciones' }, 1),
];

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: '0198c3f2a1b74e0f8c2d5a6b',
    kind: 'note',
    title: 'Presupuesto Q3',
    blocks: DECISIONS,
    generated: {},
    folderId: null,
    color: 'default',
    labels: [],
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    reminderAt: null,
    order: 0,
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
    ...overrides,
  } as Note;
}

describe('noteToMarkdown', () => {
  it('opens with the title as a heading', () => {
    // A file named after the note that opens with no heading reads as truncated.
    expect(noteToMarkdown(note()).startsWith('# Presupuesto Q3')).toBe(true);
  });

  it('writes the blocks as the Markdown they read as', () => {
    expect(noteToMarkdown(note())).toContain('## Decisions\n\n- Congelar contrataciones');
  });

  it('writes the tasks as tasks anything can read', () => {
    const markdown = noteToMarkdown(
      note({
        blocks: [
          block('a', 'todo', { text: 'Hecho', checked: true }, 0),
          block('b', 'todo', { text: 'Pendiente', checked: false }, 1),
        ],
      }),
    );
    expect(markdown).toContain('- [x] Hecho');
    expect(markdown).toContain('- [ ] Pendiente');
  });

  it('omits what the note does not have', () => {
    expect(
      noteToMarkdown(
        note({ title: '', blocks: [block('p', 'paragraph', { text: 'solo cuerpo' }, 0)] }),
      ),
    ).toBe('solo cuerpo');
    expect(noteToMarkdown(note({ blocks: [] }))).toBe('# Presupuesto Q3');
  });

  it('produces nothing for an empty note rather than a bare heading', () => {
    expect(noteToMarkdown(note({ title: '', blocks: [] }))).toBe('');
  });
});

describe('noteFilename', () => {
  it('names the file after the note', () => {
    expect(noteFilename(note())).toBe('Presupuesto Q3.md');
  });

  it('removes characters a file system refuses', () => {
    // An exported file travels; the machine that opens it is rarely the one
    // that wrote it, so this is the union of what Windows, macOS and Linux ban.
    expect(noteFilename(note({ title: 'A/B: "C" <D>|E?F*G\\H' }))).toBe('A B C D E F G H.md');
  });

  it('does not end in a dot, which Windows cannot open', () => {
    expect(noteFilename(note({ title: 'Reunión...' }))).toBe('Reunión.md');
  });

  it('keeps the name short enough for any file system', () => {
    const long = noteFilename(note({ title: 'x'.repeat(200) }));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('.md')).toBe(true);
  });

  it('falls back to the id, never to a shared name', () => {
    // Two notes called `note.md` means the second export silently replaces the
    // first — worse than an ugly filename.
    expect(noteFilename(note({ title: '' }))).toBe('0198c3f2a1b74e0f8c2d5a6b.md');
    expect(noteFilename(note({ title: '///' }))).toBe('0198c3f2a1b74e0f8c2d5a6b.md');
  });
});
