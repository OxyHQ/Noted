import { QueryClient, QueryObserver, type UseQueryOptions } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: true, user: { id: 'account-a' } as { id: string } | undefined },
  get: vi.fn(),
}));

vi.mock('@oxy.so/services', () => ({ useOxy: () => state.auth }));
vi.mock('../api/client', () => ({ default: { get: state.get } }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  // Capture the hook's actual options and give them to real QueryObservers below.
  useQuery: (options: UseQueryOptions) => options,
}));

import { useNotifications, useUnreadCount } from './use-notifications';

function options(hook: () => unknown): UseQueryOptions {
  return hook() as UseQueryOptions;
}

beforeEach(() => {
  state.auth = { isAuthenticated: true, user: { id: 'account-a' } };
  state.get.mockReset();
});

describe.each([useNotifications, useUnreadCount])('notification account isolation: %s', (hook) => {
  it('never presents the previous account cached data after switching or signing out', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const accountA = { privateNotification: 'account-a', count: 7 };
    state.get.mockResolvedValueOnce({ data: accountA });
    const observer = new QueryObserver(client, options(hook));
    await observer.refetch();
    expect(observer.getCurrentResult().data).toEqual(accountA);

    state.auth.user = { id: 'account-b' };
    observer.setOptions(options(hook));
    expect(observer.getCurrentResult().data).toBeUndefined();
    state.get.mockResolvedValueOnce({ data: { count: 0 } });
    await observer.refetch();
    expect(observer.getCurrentResult().data).toEqual({ count: 0 });

    state.auth.isAuthenticated = false;
    observer.setOptions(options(hook));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.options.enabled).toBe(false);
    // Existing mutation/socket invalidations still reach every account key.
    await client.invalidateQueries({ queryKey: ['notifications'] });
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.data !== undefined),
    ).toHaveLength(2);
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.isInvalidated),
    ).toBe(true);
    observer.destroy();
    client.clear();
  });

  it('waits for a verified user id before requesting notifications', () => {
    state.auth.user = undefined;
    expect(options(hook).enabled).toBe(false);
    expect(state.get).not.toHaveBeenCalled();
  });
});
