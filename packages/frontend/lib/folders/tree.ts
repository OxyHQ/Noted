/**
 * Folders as a tree, for display.
 *
 * The server owns the rules (depth, no cycles — `lib/folder-tree.ts` there);
 * this only lays a flat list out in reading order so a sidebar, a picker and a
 * management screen can all show the same indented list.
 */

import type { Folder } from '@noted/shared-types';

export interface FolderEntry {
  folder: Folder;
  /** 0 at the top level. */
  depth: number;
  /** "Work / Reports": the whole route to it, for a place that cannot indent. */
  path: string;
}

/** The deepest level the server allows (levels, not indent steps). */
export const MAX_FOLDER_DEPTH = 3;

/**
 * Every folder in tree order: each folder is followed by its own subfolders,
 * siblings sorted by name without regard to case.
 *
 * A folder whose parent is not in the list (not pulled yet, or removed on
 * another device a moment ago) is shown at the top rather than dropped: losing a
 * folder from view is worse than showing it in the wrong place for one sync.
 */
export function folderEntries(folders: readonly Folder[]): FolderEntry[] {
  const known = new Set(folders.map((folder) => folder.id));
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parent = folder.parentId && known.has(folder.parentId) ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const entries: FolderEntry[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const folder of children.get(parent) ?? []) {
      // A cycle cannot exist on a healthy server; this keeps a corrupt one from looping.
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
      entries.push({ folder, depth, path });
      walk(folder.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return entries;
}

/** Whether a new folder can be created inside this entry without passing the depth limit. */
export function canHaveSubfolder(entry: FolderEntry): boolean {
  return entry.depth + 1 < MAX_FOLDER_DEPTH;
}

/** How many levels a folder and everything below it span (1 for a folder with no subfolders). */
function subtreeHeight(id: string, folders: readonly Folder[], seen = new Set<string>()): number {
  if (seen.has(id)) return Number.POSITIVE_INFINITY;
  const next = new Set(seen).add(id);
  const below = folders
    .filter((folder) => folder.parentId === id)
    .map((folder) => subtreeHeight(folder.id, folders, next));
  return 1 + (below.length === 0 ? 0 : Math.max(...below));
}

/**
 * Where a folder can be moved to: the folders it may sit directly inside.
 *
 * The same rules the server enforces (`lib/folder-tree.ts` there), applied here
 * so the picker only offers moves that will be accepted: not itself, not
 * anything below it (a folder inside its own branch has no way back to the
 * top), and not so deep that the branch it carries would pass the depth limit.
 * Going to the top level is always possible and is offered separately.
 */
export function validParents(folders: readonly Folder[], folderId: string): FolderEntry[] {
  const height = subtreeHeight(folderId, folders);
  const below = new Set<string>([folderId]);
  // Collect the branch: every folder reachable by following children downward.
  for (let grew = true; grew; ) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && below.has(folder.parentId) && !below.has(folder.id)) {
        below.add(folder.id);
        grew = true;
      }
    }
  }
  return folderEntries(folders).filter(
    (entry) => !below.has(entry.folder.id) && entry.depth + 1 + height <= MAX_FOLDER_DEPTH,
  );
}
