import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  MutationObserver,
  QueryClient,
  onlineManager,
  type MutationObserverOptions,
} from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Statement } from '@/lib/db/client';

const state = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  viewer: 'viewer-a',
  post: vi.fn(),
  patch: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useMutation: (options: MutationObserverOptions) => options,
}));
vi.mock('@oxy.so/bloom/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/db/live-query', () => ({ useLiveQuery: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: { post: state.post, patch: state.patch } }));
vi.mock('@/lib/db/use-local-store', () => ({ requestSync: state.sync }));
vi.mock('@/lib/db/client', () => ({
  getActiveViewerId: () => state.viewer,
  executeTransaction: async (statements: Statement[], expectedViewerId: string) => {
    if (expectedViewerId !== state.viewer) throw new Error('Account changed');
    return statements.map(({ sql, params }) =>
      Number(state.db!.prepare(sql).run(...(params as SQLInputValue[])).changes),
    );
  },
}));
import { useCreateLabel, useUpdateLabel } from './use-labels';
import { MIGRATIONS } from '@/lib/db/migrations';

let client: QueryClient;
beforeEach(() => {
  state.db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const sql of migration) state.db.exec(sql);
  state.db.exec(
    "INSERT INTO labels (id,name,color,updated_at) VALUES ('label','Work','blue',''),('sibling','Personal','green','')",
  );
  state.viewer = 'viewer-a';
  state.post.mockReset();
  state.patch.mockReset();
  state.sync.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: 1 } } });
});
afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  state.db?.close();
});
const mutation = (hook: typeof useUpdateLabel | typeof useCreateLabel) =>
  new MutationObserver(
    client,
    hook() as unknown as MutationObserverOptions<unknown, Error, unknown>,
  );
const labels = () => state.db!.prepare('SELECT id,name,color FROM labels ORDER BY id').all();

it('persists a confirmed color change and null clear without dropping sibling labels or sending an unchanged name', async () => {
  state.patch
    .mockResolvedValueOnce({ data: { id: 'label', name: 'Renamed elsewhere', color: 'pink' } })
    .mockResolvedValueOnce({ data: { id: 'label', name: 'Renamed elsewhere', color: null } });
  await mutation(useUpdateLabel).mutate({ id: 'label', patch: { color: 'pink' } });
  expect(state.patch).toHaveBeenLastCalledWith(
    '/labels/label',
    { color: 'pink' },
    { expectedViewerId: 'viewer-a' },
  );
  expect(labels()).toEqual([
    { id: 'label', name: 'Renamed elsewhere', color: 'pink' },
    { id: 'sibling', name: 'Personal', color: 'green' },
  ]);
  await mutation(useUpdateLabel).mutate({ id: 'label', patch: { color: null } });
  expect(labels()[0]).toMatchObject({ color: null, name: 'Renamed elsewhere' });
  expect(state.db!.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
});

it('adds a colored server-confirmed label to the local read store', async () => {
  const label = { id: 'created', name: 'Travel', color: 'yellow' };
  state.post.mockResolvedValue({ data: label });
  await mutation(useCreateLabel).mutate({ name: label.name, color: label.color });
  expect(labels()).toHaveLength(3);
  expect(labels()[0]).toEqual(label);
  expect(state.post).toHaveBeenCalledWith(
    '/labels',
    { name: 'Travel', color: 'yellow' },
    { expectedViewerId: 'viewer-a' },
  );
});

it('fails an offline save without pausing or retrying it later under another account', async () => {
  onlineManager.setOnline(false);
  state.patch.mockRejectedValue(new Error('Offline'));
  const observer = mutation(useUpdateLabel);
  await expect(observer.mutate({ id: 'label', patch: { color: 'red' } })).rejects.toThrow(
    'Offline',
  );
  expect(observer.getCurrentResult().isPaused).toBe(false);
  expect(state.patch).toHaveBeenCalledTimes(1);
  expect(labels()[0]).toMatchObject({ color: 'blue' });
  expect(state.sync).not.toHaveBeenCalled();
});

it('does not apply an old account response to the newly active local store', async () => {
  state.patch.mockImplementation(async () => {
    state.viewer = 'viewer-b';
    return { data: { id: 'label', name: 'Other account secret', color: 'red' } };
  });
  await expect(
    mutation(useUpdateLabel).mutate({ id: 'label', patch: { color: 'red' } }),
  ).rejects.toThrow('Account changed');
  expect(labels()[0]).toMatchObject({ name: 'Work', color: 'blue' });
  expect(state.sync).not.toHaveBeenCalled();
});
