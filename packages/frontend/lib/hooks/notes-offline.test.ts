import { MutationObserver, QueryClient, onlineManager, type MutationObserverOptions } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const writes = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), trash: vi.fn(), restore: vi.fn(), delete: vi.fn(), reorder: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  // Exercise the actual hook options with TanStack's real mutation scheduler.
  useMutation: (options: MutationObserverOptions) => options,
}));
vi.mock('@oxy.so/bloom/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/db/live-query', () => ({ useLiveQuery: vi.fn() }));
vi.mock('@/lib/db/ids', () => ({ newNoteId: () => 'offline-note' }));
vi.mock('@/lib/notes/resume-creation', () => ({ resumeNoteCreation: writes.create }));
vi.mock('@/lib/db/notes-repo', () => ({
  updateNote: writes.update, trashNote: writes.trash, restoreNote: writes.restore,
  deleteNote: writes.delete, reorderNotes: writes.reorder,
  firstRowToNote: vi.fn(), NOTE_DETAIL_SQL: '', noteListQuery: vi.fn(), rowsToNotes: vi.fn(),
}));

import { useCreateNote, useUpdateNote, useTrashNote, useRestoreNote, useDeleteNote, useReorderNotes } from './use-notes';

beforeEach(() => {
  onlineManager.setOnline(false);
  for (const write of Object.values(writes)) write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { onlineManager.setOnline(true); });

it.each([
  { name: 'create', hook: useCreateNote, input: { title: 'Offline note' }, write: writes.create },
  { name: 'update', hook: useUpdateNote, input: { id: 'note', patch: { title: 'Edited offline' } }, write: writes.update },
  { name: 'trash', hook: useTrashNote, input: 'note', write: writes.trash },
  { name: 'restore', hook: useRestoreNote, input: 'note', write: writes.restore },
  { name: 'delete', hook: useDeleteNote, input: 'note', write: writes.delete },
  { name: 'reorder', hook: useReorderNotes, input: ['note'], write: writes.reorder },
])('runs $name against the local store while offline', async ({ hook, input, write }) => {
  const client = new QueryClient();
  const observer = new MutationObserver<unknown, Error, unknown>(client, hook() as unknown as MutationObserverOptions<unknown, Error, unknown>);
  try {
    const completed = observer.mutate(input);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1), { timeout: 200 });
    await completed;
    expect(observer.getCurrentResult().isPaused).toBe(false);
    expect(observer.getCurrentResult().status).toBe('success');
  } finally {
    client.clear();
  }
});
