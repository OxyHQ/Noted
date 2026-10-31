import { QueryClient, QueryObserver, type UseQueryOptions } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotedClient } from '../api/noted-client';

const fixture = vi.hoisted(() => ({
  auth: { isAuthenticated: true, user: { id: 'A' } as { id: string } | undefined },
  client: null as unknown as ReturnType<typeof import('../api/noted-client').createNotedClient>,
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('../api/client', () => ({
  default: { get: (...args: Parameters<typeof fixture.client.get>) => fixture.client.get(...args) },
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: (options: UseQueryOptions) => options,
}));
import { useNotifications, useUnreadCount } from './use-notifications';

const baseURL = 'https://noted.example';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (userId: string, nonce = 'first') =>
  `h.${encode({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })}.s`;
const payload = {
  notifications: [{ _id: 'notification-b', title: 'private B' }],
  unreadCount: 1,
  total: 1,
  count: 1,
};
const savedFetch = globalThis.fetch;
let oxy: OxyServices;
let queryClient: QueryClient;
function options(hook: () => unknown) {
  return { ...(hook() as UseQueryOptions), retry: false };
}
beforeEach(() => {
  fixture.auth = { isAuthenticated: true, user: { id: 'A' } };
  oxy = new OxyServices({ baseURL });
  fixture.client = createNotedClient(oxy, baseURL);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  fixture.client.dispose();
  oxy.dispose();
  queryClient.clear();
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe.each([useNotifications, useUnreadCount])('notification owner: %s', (hook) => {
  it('keeps the query disabled without a projected user', async () => {
    fixture.auth.user = undefined;
    oxy.session.setAccessToken(jwt('A'));
    const sent = vi.fn();
    globalThis.fetch = sent as typeof fetch;
    const observer = new QueryObserver(queryClient, options(hook));
    try {
      expect(observer.options.enabled).toBe(false);
      expect((await observer.refetch()).isError).toBe(true);
      expect(queryClient.getQueryData(observer.options.queryKey)).toBeUndefined();
      expect(sent).not.toHaveBeenCalled();
    } finally {
      observer.destroy();
    }
  });
  it('refuses a bearer for B while the rendered query belongs to A', async () => {
    oxy.session.setAccessToken(jwt('B'));
    const sent = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt('B')}`);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = sent as typeof fetch;
    const observer = new QueryObserver(queryClient, options(hook));
    try {
      const result = await observer.refetch();
      expect(result.isError).toBe(true);
      const accountAKey = observer.options.queryKey;
      expect(queryClient.getQueryData(accountAKey)).toBeUndefined();
      expect(sent).not.toHaveBeenCalled();
      fixture.auth.user = { id: 'B' };
      observer.setOptions(options(hook));
      expect((await observer.refetch()).data).toEqual(payload);
      expect(queryClient.getQueryData(observer.options.queryKey)).toEqual(payload);
      expect(queryClient.getQueryData(accountAKey)).toBeUndefined();
      expect(sent).toHaveBeenCalledTimes(1);
    } finally {
      observer.destroy();
    }
  });

  it('permits the same account to refresh its bearer while the query is in flight', async () => {
    oxy.session.setAccessToken(jwt('A'));
    let release!: (response: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      markStarted();
      return waiting;
    }) as typeof fetch;
    const observer = new QueryObserver(queryClient, options(hook));
    try {
      const pending = observer.refetch();
      await started;
      oxy.session.setAccessToken(jwt('A', 'refresh'));
      release(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect((await pending).data).toEqual(payload);
      expect(queryClient.getQueryData(observer.options.queryKey)).toEqual(payload);
    } finally {
      observer.destroy();
    }
  });

  it.each([false, true])(
    'aborts an in-flight A request on B, return to A: %s',
    async (returnToA) => {
      oxy.session.setAccessToken(jwt('A'));
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      globalThis.fetch = vi.fn(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            markStarted();
          }),
      ) as typeof fetch;
      const observer = new QueryObserver(queryClient, options(hook));
      try {
        const pending = observer.refetch();
        await started;
        oxy.session.setAccessToken(jwt('B'));
        if (returnToA) oxy.session.setAccessToken(jwt('A', 'returned'));
        expect((await pending).isError).toBe(true);
        expect(queryClient.getQueryData(observer.options.queryKey)).toBeUndefined();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      } finally {
        observer.destroy();
      }
    },
  );

  it('fails closed when the bearer cannot identify its subject', async () => {
    oxy.session.setAccessToken('opaque-fixture');
    const sent = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    globalThis.fetch = sent as typeof fetch;
    const observer = new QueryObserver(queryClient, options(hook));
    try {
      expect((await observer.refetch()).isError).toBe(true);
      expect(queryClient.getQueryData(observer.options.queryKey)).toBeUndefined();
      expect(sent).not.toHaveBeenCalled();
    } finally {
      observer.destroy();
    }
  });
});
