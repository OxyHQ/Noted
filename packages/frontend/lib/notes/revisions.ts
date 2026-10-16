import type { NoteBlock } from '@/lib/notes/blocks';
import { renumber } from '@/lib/notes/blocks';
import type { NoteInput } from '@/lib/db/notes-repo';

/**
 * A note's history is its Nilo page's: a version is the blocks as they were
 * before the first change after a quiet spell, and before every restore.
 */

/** One entry of `GET /pages/:id/versions`, newest first. */
export interface RevisionSummary {
  id: string;
  createdAt: string;
  createdBy: string;
  blockCount: number;
}

/** One version's blocks (`GET /pages/:id/versions/:versionId`). */
export interface RevisionDetail {
  id: string;
  createdAt: string;
  blocks: NoteBlock[];
}

/**
 * The edit that puts a version's blocks back.
 *
 * Applied like any other local edit, so it syncs through the outbox and Nilo
 * keeps the blocks it replaces as a version of their own: a restore is never
 * destructive. Set whole (`blocks`), which clears the recorder's map: the
 * restored text is the user's now, and a later recording must not treat it
 * as its own to rewrite.
 */
export function revisionToPatch(revision: RevisionDetail): Pick<NoteInput, 'blocks'> {
  return { blocks: renumber(revision.blocks) };
}
