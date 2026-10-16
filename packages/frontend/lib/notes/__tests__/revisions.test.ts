import { describe, expect, it } from 'vitest';
import { revisionToPatch } from '@/lib/notes/revisions';

describe('revisionToPatch', () => {
  it("puts the version's blocks back whole, so the recorder's map is cleared", () => {
    const patch = revisionToPatch({
      id: 'r1',
      createdAt: '2026-10-13T10:00:00.000Z',
      blocks: [
        {
          id: 'b',
          parentBlockId: null,
          type: 'todo',
          content: { text: 'milk', checked: true },
          order: 4,
        },
      ],
    });
    // `blocks`, not an edit: content set whole, which the store treats as the
    // user's — a later recording does not rewrite restored text.
    expect(patch).toEqual({
      blocks: [
        {
          id: 'b',
          parentBlockId: null,
          type: 'todo',
          content: { text: 'milk', checked: true },
          order: 0,
        },
      ],
    });
  });
});
