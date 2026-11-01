import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn(),
  executeTransaction: vi.fn(),
  getActiveViewerId: () => 'alice',
}));
vi.mock('@/lib/capture/captures-repo', () => ({ deleteNoteRecordings: vi.fn() }));
import { executeTransaction } from '@/lib/db/client';
import { deleteNoteRecordings } from '@/lib/capture/captures-repo';
import { deleteNote } from '@/lib/db/notes-repo';

describe('deleting a note', () => {
  it('does not discard the note when its recording cannot be removed', async () => {
    vi.mocked(deleteNoteRecordings).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(deleteNote('note')).rejects.toThrow();
    expect(executeTransaction).not.toHaveBeenCalled();
  });
});
