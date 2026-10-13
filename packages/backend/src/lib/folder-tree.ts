/**
 * The rules for folders that sit inside folders.
 *
 * Pure, over the user's whole folder list (a person has a handful, so loading
 * them all to validate one move is cheaper than being clever in SQL). The route
 * asks these questions before it writes; the database cannot, because "would
 * this make a folder its own ancestor" is a property of the whole tree.
 */

/** Deeper than this stops being navigable on a phone and starts being a filing cabinet. */
export const MAX_FOLDER_DEPTH = 3;

export interface FolderNode {
  id: string;
  parentId: string | null;
}

export type FolderPlacementError = 'parent-not-found' | 'cycle' | 'too-deep';

function indexById(nodes: readonly FolderNode[]): Map<string, FolderNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** 1 for a top-level folder. Guards against a cycle that should not exist but must not hang. */
export function depthOf(id: string, nodes: readonly FolderNode[]): number {
  const byId = indexById(nodes);
  let depth = 0;
  const seen = new Set<string>();
  for (
    let current = byId.get(id);
    current;
    current = current.parentId ? byId.get(current.parentId) : undefined
  ) {
    if (seen.has(current.id)) return Number.POSITIVE_INFINITY;
    seen.add(current.id);
    depth += 1;
  }
  return depth;
}

/** 1 for a folder with no children: how many levels the folder and everything below it span. */
export function subtreeHeight(id: string, nodes: readonly FolderNode[]): number {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId)
      children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const visit = (current: string, seen: Set<string>): number => {
    if (seen.has(current)) return Number.POSITIVE_INFINITY;
    const next = new Set(seen).add(current);
    const below = (children.get(current) ?? []).map((child) => visit(child, next));
    return 1 + (below.length === 0 ? 0 : Math.max(...below));
  };
  return visit(id, new Set());
}

/** Whether `candidate` is `id` or sits anywhere below it. */
export function isWithin(candidate: string, id: string, nodes: readonly FolderNode[]): boolean {
  const byId = indexById(nodes);
  const seen = new Set<string>();
  for (
    let current = byId.get(candidate);
    current;
    current = current.parentId ? byId.get(current.parentId) : undefined
  ) {
    if (current.id === id) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
  }
  return false;
}

/**
 * Whether `folderId` may sit under `newParentId` (null = the top level).
 *
 * `folderId` is null for a folder that does not exist yet, which has nothing
 * below it and cannot be its own ancestor.
 */
export function checkPlacement(input: {
  folderId: string | null;
  newParentId: string | null;
  nodes: readonly FolderNode[];
}): FolderPlacementError | null {
  const { folderId, newParentId, nodes } = input;
  if (newParentId === null) return null;
  if (!nodes.some((node) => node.id === newParentId)) return 'parent-not-found';
  if (folderId !== null && isWithin(newParentId, folderId, nodes)) return 'cycle';

  const parentDepth = depthOf(newParentId, nodes);
  const height = folderId === null ? 1 : subtreeHeight(folderId, nodes);
  return parentDepth + height > MAX_FOLDER_DEPTH ? 'too-deep' : null;
}
