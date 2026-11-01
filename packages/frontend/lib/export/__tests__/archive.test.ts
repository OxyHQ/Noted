import { describe, expect, it } from 'vitest';

import { notesToArchive, uniqueFilenames } from '@/lib/export/archive';
import { crc32, createZip } from '@/lib/export/zip';
import type { LocalNote as Note } from '@/lib/db/notes-repo';

function note(id: string, title: string, body = 'texto'): Note {
  return {
    id,
    kind: 'note',
    title,
    blocks: body
      ? [
          {
            id: `${id}-p`,
            parentBlockId: null,
            type: 'paragraph',
            content: { text: body },
            order: 0,
          },
        ]
      : [],
    generated: {},
    folderId: null,
    color: 'default',
    labels: [],
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    removedAttachments: [],
    reminderAt: null,
    order: 0,
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
  } as Note;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('createZip', () => {
  it('writes local headers, a central directory and an end record', () => {
    const zip = createZip([{ name: 'a.md', contents: 'hola' }], new Date(2026, 7, 9, 10, 0, 0));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    // The central directory starts where the end record says it does.
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });

  it('stores the contents verbatim, UTF-8', () => {
    const zip = createZip([{ name: 'ñ.md', contents: 'canción' }]);
    expect(new TextDecoder().decode(zip)).toContain('canción');
  });

  it('is a valid empty archive with no entries', () => {
    expect(createZip([]).length).toBe(22);
  });
});

describe('uniqueFilenames', () => {
  it('keeps two notes with the same title apart', () => {
    const names = uniqueFilenames([note('a', 'Ideas'), note('b', 'Ideas'), note('c', 'ideas')]);
    expect(names).toEqual(['Ideas.md', 'Ideas (2).md', 'ideas (3).md']);
  });

  it('keeps names distinct when an emoji is cut at the length limit', () => {
    const stem = 'x'.repeat(59);
    expect(uniqueFilenames([note('a', `${stem}📝`), note('b', stem)])).toEqual([
      `${stem}.md`,
      `${stem} (2).md`,
    ]);
  });
});

describe('notesToArchive', () => {
  it('contains each note as its Markdown file', () => {
    const text = new TextDecoder().decode(notesToArchive([note('a', 'Plan', 'cuerpo')]));
    expect(text).toContain('Plan.md');
    expect(text).toContain('# Plan\n\ncuerpo');
  });

  it('does not write a replacement character when a filename limit splits an emoji', () => {
    const title = `${'x'.repeat(59)}📝`;
    const zip = notesToArchive([note('a', title)]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const nameLength = view.getUint16(26, true);
    const filename = new TextDecoder('utf-8', { fatal: true }).decode(
      zip.subarray(30, 30 + nameLength),
    );
    expect(filename).toBe(`${'x'.repeat(59)}.md`);
    expect(new TextDecoder().decode(zip)).toContain(`# ${title}`);
  });
});
