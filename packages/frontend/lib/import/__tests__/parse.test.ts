import { describe, expect, it } from 'vitest';
import { noteToMarkdown } from '@/lib/export/markdown';
import { parseEnex, parseImportFile, parseKeep, parseMarkdown } from '@/lib/import/parse';

let counter = 0;
const makeId = () => `id-${++counter}`;

describe('parseMarkdown', () => {
  it('takes a leading # heading as the title and removes it from the body', () => {
    const note = parseMarkdown('x.md', '\n# Weekly plan\n\nSee the roadmap.\n');
    expect(note.title).toBe('Weekly plan');
    expect(note.body).toBe('See the roadmap.');
  });

  it('preserves hashes attached to a title while accepting closing heading markers', () => {
    for (const title of ['C#', 'F#', 'C##']) {
      const exported = noteToMarkdown({ title, blocks: [] });
      expect(parseMarkdown('note.md', exported).title).toBe(title);
    }
    expect(parseMarkdown('note.md', '# C# ##\n\nBody').title).toBe('C#');
    expect(parseMarkdown('note.md', '# F#\t###').title).toBe('F#');
  });

  it('falls back to the filename when there is no heading', () => {
    const note = parseMarkdown('folder/Shopping list.md', 'milk\neggs');
    expect(note.title).toBe('Shopping list');
    expect(note.body).toBe('milk\neggs');
  });

  it('does not treat a later heading, or a ## heading, as the title', () => {
    expect(parseMarkdown('a.md', 'intro\n# Later').title).toBe('a');
    expect(parseMarkdown('a.md', '## Section\ntext').title).toBe('a');
  });

  it('reads Obsidian front matter tags in all three shapes and drops the block', () => {
    const inline = parseMarkdown('a.md', '---\ntags: [work, "q4"]\n---\n# T\nbody');
    expect(inline.labelNames).toEqual(['work', 'q4']);
    expect(inline.body).toBe('body');

    expect(parseMarkdown('a.md', '---\ntags: #home, errands\n---\nbody').labelNames).toEqual([
      'home',
      'errands',
    ]);
    expect(
      parseMarkdown('a.md', '---\ntitle: x\ntags:\n  - a\n  - b/c\n---\nbody').labelNames,
    ).toEqual(['a', 'b/c']);
  });

  it('keeps text that merely starts with --- but is not front matter', () => {
    const note = parseMarkdown('a.md', '---\njust a rule, never closed');
    expect(note.body).toContain('just a rule');
  });

  it('handles CRLF and a byte-order mark', () => {
    const note = parseMarkdown('a.md', '﻿---\r\ntags: [x]\r\n---\r\n# T\r\nbody\r\n');
    expect(note.title).toBe('T');
    expect(note.labelNames).toEqual(['x']);
    expect(note.body).toBe('body');
  });

  it('ignores absurdly long or duplicate tags', () => {
    const note = parseMarkdown('a.md', `---\ntags: [a, a, ${'x'.repeat(200)}]\n---\nb`);
    expect(note.labelNames).toEqual(['a']);
  });
});

describe('parseKeep', () => {
  const keep = {
    title: 'Groceries',
    textContent: 'before friday',
    listContent: [
      { text: 'oat milk', isChecked: false },
      { text: 'bread', isChecked: true },
      { text: '   ', isChecked: false },
    ],
    labels: [{ name: 'home' }, { name: 'home' }],
    isPinned: true,
    isArchived: false,
    isTrashed: false,
    color: 'TEAL',
  };

  it('maps text, checklist, labels, flags and colour', () => {
    const result = parseKeep(JSON.stringify(keep), makeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [note] = result.notes;
    expect(note.title).toBe('Groceries');
    expect(note.body).toBe('before friday');
    expect(note.checklist.map((i) => [i.text, i.checked])).toEqual([
      ['oat milk', false],
      ['bread', true],
    ]);
    expect(new Set(note.checklist.map((i) => i.id)).size).toBe(2);
    expect(note.labelNames).toEqual(['home']);
    expect(note.pinned).toBe(true);
    expect(note.color).not.toBe('default');
  });

  it('falls back to the default colour for one it does not know', () => {
    const result = parseKeep(JSON.stringify({ ...keep, color: 'DEFAULT' }), makeId);
    expect(result.ok && result.notes[0].color).toBe('default');
  });

  it('rejects JSON that is not a Keep note, and text that is not JSON', () => {
    expect(parseKeep('{"hello":1}', makeId)).toEqual({
      ok: false,
      reason: 'not a Google Keep note',
    });
    expect(parseKeep('nope', makeId)).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(parseKeep('[1,2]', makeId).ok).toBe(false);
  });
});

describe('parseImportFile', () => {
  it('routes by extension, case-insensitively', () => {
    expect(parseImportFile('A.MD', '# T', makeId).ok).toBe(true);
    expect(parseImportFile('a.txt', 'hi', makeId).ok).toBe(true);
    expect(parseImportFile('a.json', '{"textContent":"x"}', makeId).ok).toBe(true);
  });

  it('says why a file was skipped', () => {
    expect(parseImportFile('a.docx', '', makeId)).toEqual({
      ok: false,
      reason: '.docx files are not supported',
    });
  });
});

describe('Evernote (ENEX)', () => {
  const enex = (content: string, extra = '') => `<?xml version="1.0"?>
<en-export><note><title>Plan &amp; ideas</title><content><![CDATA[<?xml version="1.0"?>
<en-note>${content}</en-note>]]></content>${extra}</note></en-export>`;

  it('reads the title, tags and body', () => {
    const result = parseImportFile(
      'Evernote.enex',
      enex('<div>Hola <b>mundo</b></div>', '<tag>trabajo</tag><tag>q3</tag>'),
      makeId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes[0]).toMatchObject({
      title: 'Plan & ideas',
      body: 'Hola **mundo**',
      labelNames: ['trabajo', 'q3'],
    });
  });

  it('turns checkboxes, headings, lists and links into Markdown', () => {
    const result = parseEnex(
      enex(
        '<h2>Tareas</h2><div><en-todo checked="true"/>Hecho</div><div><en-todo/>Pendiente</div>' +
          '<ul><li>uno</li><li>dos</li></ul><a href="https://oxy.so">Oxy</a>',
      ),
    );
    expect(result.ok && result.notes[0]?.body).toBe(
      '## Tareas\n\n- [x] Hecho\n- [ ] Pendiente\n\n- uno\n- dos\n[Oxy](https://oxy.so)',
    );
  });

  it('imports every note in a file', () => {
    const two = `<en-export><note><title>A</title><content>x</content></note><note><title>B</title><content>y</content></note></en-export>`;
    const result = parseEnex(two);
    expect(result.ok && result.notes.map((n) => n.title)).toEqual(['A', 'B']);
  });

  it('refuses a file that is not an export', () => {
    expect(parseEnex('<html></html>').ok).toBe(false);
  });
});
