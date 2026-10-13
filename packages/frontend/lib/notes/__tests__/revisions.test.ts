import { describe, expect, it } from 'vitest';
import { revisionToPatch } from '@/lib/notes/revisions';

describe('revisionToPatch', () => {
  it("puts the version's text back and hands generated text over to the user", () => {
    const patch = revisionToPatch({
      id: 'r1',
      createdAt: '2026-10-13T10:00:00.000Z',
      title: 'Old title',
      body: 'old body',
      checklist: [{ id: 'a', text: 'milk', checked: true }],
    });
    expect(patch).toEqual({
      title: 'Old title',
      body: 'old body',
      generatedBody: '',
      checklist: [{ id: 'a', text: 'milk', checked: true }],
    });
  });
});
