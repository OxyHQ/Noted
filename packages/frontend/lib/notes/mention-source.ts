/**
 * Linking a note from inside another: `@` in the editor offers the user's
 * notes by title, and the link is a page mention (`{ kind: 'page', id }`),
 * the same mark Nilo writes for a link to a page — the notes are Nilo pages,
 * so a link made here opens there too, and backlinks find it by id.
 */
import type { MentionItem, MentionSource } from '@oxy.so/bloom-editor';
import type { Segment } from '@oxy.so/bloom-text/model';

import { execute } from '@/lib/db/client';

const MAX_RESULTS = 8;

export function noteMentionSource(currentId: string, untitled: string): MentionSource {
  return {
    indicators: ['@'],
    async search({ text }): Promise<readonly MentionItem[]> {
      const rows = await execute<{ id: string; title: string }>(
        `SELECT id, title FROM notes
         WHERE deleted_at IS NULL AND trashed = 0 AND id != ? AND lower(title) LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ?`,
        [currentId, `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`, MAX_RESULTS],
      );
      return rows.map((row) => ({
        id: row.id,
        label: row.title.trim() || untitled,
        attributes: { kind: 'page', id: row.id },
      }));
    },
  };
}

/** A paragraph holding a link to `note`, for the "link a note" action. */
export function linkParagraph(note: { id: string; title: string }): {
  text: string;
  segments: Segment[];
} {
  const label = note.title.trim();
  return {
    text: label,
    segments: [
      { text: label, mention: { indicator: '@', attributes: { kind: 'page', id: note.id } } },
    ],
  };
}
