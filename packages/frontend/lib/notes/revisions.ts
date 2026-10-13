import type { ChecklistItem } from '@noted/shared-types';
import type { LocalNote } from '@/lib/db/notes-repo';

/** One entry of `GET /notes/:id/revisions`. */
export interface RevisionSummary {
  id: string;
  createdAt: string;
  title: string;
  preview: string;
  checklistItems: number;
}

/** One version's full text (`GET /notes/:id/revisions/:revisionId`). */
export interface RevisionDetail {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  checklist: ChecklistItem[];
}

/**
 * The edit that puts a version's text back.
 *
 * Applied like any other local edit, so it syncs through the outbox and the
 * server snapshots the text it replaces: a restore is never destructive.
 * `generatedBody` is cleared because the restored text is now the user's — the
 * app's record of which lines it wrote described the text that is being
 * replaced, and keeping it would let a later recording treat restored text as
 * its own to rewrite.
 */
export function revisionToPatch(
  revision: RevisionDetail,
): Pick<LocalNote, 'title' | 'body' | 'generatedBody' | 'checklist'> {
  return {
    title: revision.title,
    body: revision.body,
    generatedBody: '',
    checklist: revision.checklist,
  };
}
