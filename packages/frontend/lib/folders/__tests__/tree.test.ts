import { describe, expect, it } from 'vitest';
import type { Folder } from '@noted/shared-types';
import { canHaveSubfolder, folderEntries } from '@/lib/folders/tree';

const f = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  name,
  parentId,
});

describe('folderEntries', () => {
  it('lists each folder followed by its own subfolders, siblings by name', () => {
    const entries = folderEntries([
      f('q4', 'Q4', 'reports'),
      f('home', 'home'),
      f('work', 'Work'),
      f('reports', 'Reports', 'work'),
      f('inbox', 'Inbox', 'work'),
    ]);
    expect(entries.map((e) => e.folder.id)).toEqual(['home', 'work', 'inbox', 'reports', 'q4']);
    expect(entries.map((e) => e.depth)).toEqual([0, 0, 1, 1, 2]);
  });

  it('sorts without regard to case', () => {
    const ids = folderEntries([f('b', 'beta'), f('a', 'Alpha'), f('c', 'CHARLIE')]).map(
      (e) => e.folder.id,
    );
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('gives the whole route as a path', () => {
    const entries = folderEntries([f('w', 'Work'), f('r', 'Reports', 'w'), f('q', 'Q4', 'r')]);
    expect(entries.map((e) => e.path)).toEqual(['Work', 'Work / Reports', 'Work / Reports / Q4']);
  });

  it('treats a missing parentId as the top level', () => {
    const [entry] = folderEntries([{ id: 'x', name: 'X' }]);
    expect(entry.depth).toBe(0);
  });

  it('shows a folder whose parent is unknown at the top instead of dropping it', () => {
    const entries = folderEntries([f('orphan', 'Orphan', 'gone'), f('a', 'A')]);
    expect(entries.map((e) => e.folder.id)).toEqual(['a', 'orphan']);
    expect(entries.every((e) => e.depth === 0)).toBe(true);
  });

  it('does not loop on a corrupt cycle', () => {
    const entries = folderEntries([f('a', 'A', 'b'), f('b', 'B', 'a'), f('c', 'C')]);
    expect(entries.map((e) => e.folder.id)).toEqual(['c']);
  });
});

describe('canHaveSubfolder', () => {
  it('stops at the third level', () => {
    const entries = folderEntries([f('w', 'W'), f('r', 'R', 'w'), f('q', 'Q', 'r')]);
    expect(entries.map(canHaveSubfolder)).toEqual([true, true, false]);
  });
});
