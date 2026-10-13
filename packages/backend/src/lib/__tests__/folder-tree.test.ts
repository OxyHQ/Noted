import { describe, expect, it } from 'bun:test';
import {
  MAX_FOLDER_DEPTH,
  checkPlacement,
  depthOf,
  isWithin,
  subtreeHeight,
  type FolderNode,
} from '../folder-tree';

// work ─ reports ─ q4
// home
const tree: FolderNode[] = [
  { id: 'work', parentId: null },
  { id: 'reports', parentId: 'work' },
  { id: 'q4', parentId: 'reports' },
  { id: 'home', parentId: null },
];

describe('folder tree', () => {
  it('measures depth from the top', () => {
    expect(depthOf('work', tree)).toBe(1);
    expect(depthOf('q4', tree)).toBe(3);
    expect(depthOf('missing', tree)).toBe(0);
  });

  it('measures how many levels a folder and its descendants span', () => {
    expect(subtreeHeight('q4', tree)).toBe(1);
    expect(subtreeHeight('work', tree)).toBe(3);
    expect(subtreeHeight('home', tree)).toBe(1);
  });

  it('knows what sits inside what', () => {
    expect(isWithin('q4', 'work', tree)).toBe(true);
    expect(isWithin('work', 'work', tree)).toBe(true);
    expect(isWithin('work', 'q4', tree)).toBe(false);
    expect(isWithin('home', 'work', tree)).toBe(false);
  });

  it('allows a top-level placement and a placement within the depth limit', () => {
    expect(checkPlacement({ folderId: null, newParentId: null, nodes: tree })).toBeNull();
    expect(checkPlacement({ folderId: null, newParentId: 'home', nodes: tree })).toBeNull();
    expect(checkPlacement({ folderId: 'q4', newParentId: 'home', nodes: tree })).toBeNull();
  });

  it('refuses a parent that does not exist', () => {
    expect(checkPlacement({ folderId: null, newParentId: 'nope', nodes: tree })).toBe(
      'parent-not-found',
    );
  });

  it('refuses to make a folder its own ancestor', () => {
    expect(checkPlacement({ folderId: 'work', newParentId: 'work', nodes: tree })).toBe('cycle');
    expect(checkPlacement({ folderId: 'work', newParentId: 'q4', nodes: tree })).toBe('cycle');
  });

  it('refuses a new folder below the deepest level', () => {
    expect(MAX_FOLDER_DEPTH).toBe(3);
    expect(checkPlacement({ folderId: null, newParentId: 'q4', nodes: tree })).toBe('too-deep');
  });

  it('counts the whole subtree when moving a folder that has children', () => {
    // `work` spans 3 levels; under `home` (depth 1) it would reach depth 4.
    expect(checkPlacement({ folderId: 'work', newParentId: 'home', nodes: tree })).toBe('too-deep');
    // `reports` spans 2; under `home` it reaches depth 3, which is allowed.
    expect(checkPlacement({ folderId: 'reports', newParentId: 'home', nodes: tree })).toBeNull();
  });

  it('does not hang on a corrupt cycle', () => {
    const corrupt: FolderNode[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(depthOf('a', corrupt)).toBe(Number.POSITIVE_INFINITY);
    expect(subtreeHeight('a', corrupt)).toBe(Number.POSITIVE_INFINITY);
    expect(isWithin('a', 'zzz', corrupt)).toBe(false);
  });
});
