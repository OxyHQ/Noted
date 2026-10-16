import { describe, expect, it, vi } from 'vitest';
import type { Label } from '@noted/shared-types';
import type { NoteInput } from '@/lib/db/notes-repo';
import { IMPORT_LIMITS, MAX_IMPORT_FILES, runImport } from '@/lib/import/run';
import { plainText, todos } from '@/lib/notes/blocks';

const contentOf = (input: NoteInput) => input.blocks ?? [];

const label = (id: string, name: string): Label => ({ id, name, color: null }) as Label;

function deps(
  overrides: { labels?: Label[]; createLabel?: (name: string) => Promise<Label | null> } = {},
) {
  let n = 0;
  return {
    makeId: () => `id-${++n}`,
    createNote: vi
      .fn<(id: string, input: NoteInput) => Promise<unknown>>()
      .mockResolvedValue(undefined),
    labels: overrides.labels ?? [],
    createLabel: vi.fn(
      overrides.createLabel ?? (async (name: string) => label(`new-${name}`, name)),
    ),
  };
}

describe('runImport', () => {
  it('creates a note per file and reuses labels the account already has', async () => {
    const d = deps({ labels: [label('l-work', 'Work')] });
    const summary = await runImport(
      [
        { name: 'a.md', text: '---\ntags: [work, home]\n---\n# A\nbody' },
        { name: 'b.md', text: '---\ntags: [home]\n---\n# B' },
      ],
      d,
    );

    expect(summary).toEqual({ imported: 2, skipped: [] });
    // `work` matched case-insensitively; `home` was created once and shared.
    expect(d.createLabel).toHaveBeenCalledTimes(1);
    expect(d.createLabel).toHaveBeenCalledWith('home');
    expect(d.createNote.mock.calls[0][1]).toMatchObject({
      title: 'A',
      labels: ['l-work', 'new-home'],
    });
    // The Markdown, read as the blocks it means.
    expect(plainText(contentOf(d.createNote.mock.calls[0][1]))).toBe('body');
    expect(d.createNote.mock.calls[1][1].labels).toEqual(['new-home']);
  });

  it('keeps the note when a label cannot be created', async () => {
    const d = deps({ createLabel: async () => null });
    const summary = await runImport([{ name: 'a.md', text: '---\ntags: [x]\n---\nbody' }], d);
    expect(summary.imported).toBe(1);
    expect(d.createNote.mock.calls[0][1].labels).toEqual([]);
  });

  it('skips, with a reason, what the server would refuse forever', async () => {
    const d = deps();
    const summary = await runImport(
      [
        { name: 'huge.md', text: 'x'.repeat(IMPORT_LIMITS.body + 1) },
        { name: 'photo.png', text: '' },
        { name: 'bad.json', text: 'nope' },
        { name: 'ok.md', text: 'fine' },
      ],
      d,
    );
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toEqual([
      { name: 'huge.md', reason: 'the note is too long' },
      { name: 'photo.png', reason: '.png files are not supported' },
      { name: 'bad.json', reason: 'not valid JSON' },
    ]);
  });

  it('truncates an over-long title instead of losing the note', async () => {
    const d = deps();
    await runImport([{ name: 'a.md', text: `# ${'t'.repeat(2_000)}\nbody` }], d);
    expect(d.createNote.mock.calls[0][1].title).toHaveLength(IMPORT_LIMITS.title);
  });

  it('imports the first batch and reports the rest as skipped', async () => {
    const d = deps();
    const files = Array.from({ length: MAX_IMPORT_FILES + 2 }, (_, i) => ({
      name: `n${i}.md`,
      text: 'x',
    }));
    const summary = await runImport(files, d);
    expect(summary.imported).toBe(MAX_IMPORT_FILES);
    expect(summary.skipped).toHaveLength(2);
  });

  it('carries the Keep flags and checklist through', async () => {
    const d = deps();
    await runImport(
      [
        {
          name: 'k.json',
          text: JSON.stringify({
            title: 'T',
            textContent: '',
            listContent: [{ text: 'a', isChecked: true }],
            isPinned: true,
            isArchived: true,
          }),
        },
      ],
      d,
    );
    expect(d.createNote.mock.calls[0][1]).toMatchObject({ pinned: true, archived: true });
    expect(
      todos(contentOf(d.createNote.mock.calls[0][1])).map(({ text, checked }) => ({
        text,
        checked,
      })),
    ).toEqual([{ text: 'a', checked: true }]);
  });
});
