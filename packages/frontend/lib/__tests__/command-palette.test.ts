import { describe, expect, it, vi } from 'vitest';
import { MAX_NOTE_RESULTS, buildPaletteEntries, type PaletteCommand } from '@/lib/command-palette';

const run = vi.fn();
const commands: PaletteCommand[] = [
  { id: 'new', label: 'New note', group: 'Actions', keywords: ['create', 'write'], run },
  { id: 'trash', label: 'Trash', group: 'Go to', run },
  { id: 'settings', label: 'Settings', group: 'Go to', keywords: ['preferences'], run },
];

const base = { untitled: 'Untitled', notesGroup: 'Notes', openNote: vi.fn() };

describe('buildPaletteEntries', () => {
  it('lists every command, and no notes, before anything is typed', () => {
    const entries = buildPaletteEntries({
      ...base,
      query: '  ',
      commands,
      notes: [{ id: 'n1', title: 'A note' }],
    });
    expect(entries.map((e) => e.id)).toEqual(['new', 'trash', 'settings']);
  });

  it('matches a command by its label or a hidden keyword', () => {
    const ids = (query: string) =>
      buildPaletteEntries({ ...base, query, commands, notes: [] }).map((e) => e.id);
    expect(ids('tra')).toEqual(['trash']);
    expect(ids('PREFERENCES')).toEqual(['settings']);
    expect(ids('write')).toEqual(['new']);
    expect(ids('zzz')).toEqual([]);
  });

  it('needs every typed word to match, in any order', () => {
    const ids = buildPaletteEntries({ ...base, query: 'note new', commands, notes: [] }).map(
      (e) => e.id,
    );
    expect(ids).toEqual(['new']);
  });

  it('puts commands before notes and names an untitled note', () => {
    const entries = buildPaletteEntries({
      ...base,
      query: 'trash',
      commands,
      notes: [
        { id: 'n1', title: 'Trash day schedule' },
        { id: 'n2', title: '   ' },
      ],
    });
    expect(entries.map((e) => e.label)).toEqual(['Trash', 'Trash day schedule', 'Untitled']);
    expect(entries[1].group).toBe('Notes');
  });

  it('opens the right note when its entry runs', () => {
    const openNote = vi.fn();
    const [entry] = buildPaletteEntries({
      ...base,
      openNote,
      query: 'x',
      commands: [],
      notes: [{ id: 'abc', title: 'X' }],
    });
    entry.run();
    expect(openNote).toHaveBeenCalledWith('abc');
  });

  it('caps the notes it shows', () => {
    const notes = Array.from({ length: MAX_NOTE_RESULTS + 5 }, (_, i) => ({
      id: `n${i}`,
      title: `Note ${i}`,
    }));
    const entries = buildPaletteEntries({ ...base, query: 'note', commands: [], notes });
    expect(entries).toHaveLength(MAX_NOTE_RESULTS);
  });
});
