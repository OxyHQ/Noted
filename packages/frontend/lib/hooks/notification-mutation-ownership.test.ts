import React from 'react';
import { createRequire } from 'node:module';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type MutateOptions,
} from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotedClient } from '../api/noted-client';
const { create, act } = createRequire(import.meta.url)('react-test-renderer');

const fixture = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: null as unknown as OxyServices,
  },
  oxy: null as unknown as OxyServices,
  client: null as unknown as ReturnType<typeof import('../api/noted-client').createNotedClient>,
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('../oxy', () => ({
  get oxyServices() {
    return fixture.oxy;
  },
}));
vi.mock('../api/client', () => ({
  default: {
    patch: (...args: Parameters<typeof fixture.client.patch>) => fixture.client.patch(...args),
    post: (...args: Parameters<typeof fixture.client.post>) => fixture.client.post(...args),
  },
}));
import { useMarkAllAsRead, useMarkAsRead, useDismissNotification } from './use-notifications';

const baseURL = 'https://noted.example';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (userId: string, nonce = 'first') =>
  `h.${encode({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })}.s`;
const savedFetch = globalThis.fetch;
let oxy: OxyServices;
let client: QueryClient;
let root: { update(element: React.ReactNode): void; unmount(): void } | undefined;
type Invocation = (
  id: string | undefined,
  options?: MutateOptions<unknown, Error, string | undefined>,
) => Promise<unknown>;
type Fire = (
  id: string | undefined,
  options?: MutateOptions<unknown, Error, string | undefined>,
) => void;
let invoke: Invocation;
let fire: Fire;
let hook: () => { mutateAsync: unknown; mutate: unknown };
let show = true;
function Harness() {
  const current = hook();
  invoke = current.mutateAsync as Invocation;
  fire = current.mutate as Fire;
  return null;
}
function App() {
  return React.createElement(
    QueryClientProvider,
    { client },
    show ? React.createElement(Harness) : null,
  );
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  oxy = new OxyServices({ baseURL });
  oxy.session.setAccessToken(jwt('A'));
  fixture.oxy = oxy;
  show = true;
  fixture.auth = {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
  };
  fixture.client = createNotedClient(oxy, baseURL);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(async () => {
  onlineManager.setOnline(true);
  if (root) await act(async () => root?.unmount());
  root = undefined;
  fixture.client.dispose();
  oxy.dispose();
  client.clear();
  globalThis.fetch = savedFetch;
});

describe.each([
  ['read', useMarkAsRead, '/notifications/old-a/read'],
  ['dismiss', useDismissNotification, '/notifications/old-a/dismiss'],
  ['read all', useMarkAllAsRead, '/notifications/read-all'],
] as const)('notification mutation %s', (_name, selected, path) => {
  it('rejects an A handler retained across a switch before sending with B bearer', async () => {
    hook = selected;
    const sent = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${baseURL}${path}`);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt('B')}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const oldHandler = invoke;
    await act(async () => {
      oxy.session.setAccessToken(jwt('B'));
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
    });
    await act(async () => {
      await expect(oldHandler('old-a')).rejects.toThrow('active account changed');
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it('runs the current account mutation and preserves invocation callback variables', async () => {
    hook = selected;
    const sent = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt('A')}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    client.setQueryData(['notifications', 'A', 'unread-count'], { count: 1 });
    client.setQueryData(['notifications', 'B', 'unread-count'], { count: 2 });
    const onSuccess = vi.fn();
    await act(async () => {
      await invoke('current-a', { onSuccess });
    });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][1]).toBe('current-a');
    expect(client.getQueryState(['notifications', 'A', 'unread-count'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['notifications', 'B', 'unread-count'])?.isInvalidated).toBe(false);
  });

  it('preserves same-session refresh and the public mutate callback contract', async () => {
    hook = selected;
    const sent = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt('A', 'fresh')}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const current = fire;
    let done!: () => void;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    const onSuccess = vi.fn((_data: unknown, _variables: string | undefined) => done());
    const value = _name === 'read all' ? undefined : 'current-a';
    await act(async () => {
      oxy.session.setAccessToken(jwt('A', 'fresh'));
      current(value, { onSuccess });
      await finished;
    });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][1]).toBe(value);
  });

  it('suppresses callbacks supplied to stale mutate after an account switch', async () => {
    hook = selected;
    globalThis.fetch = vi.fn() as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const old = fire;
    await act(async () => {
      oxy.session.setAccessToken(jwt('B'));
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.mutation.state.status === 'error') finish();
    });
    try {
      await act(async () => {
        old('old-a', { onSuccess, onError, onSettled });
        await done;
      });
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(onSettled).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('delivers ordinary request errors to the owning invocation', async () => {
    hook = selected;
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'denied' }), { status: 403 }),
    ) as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const onError = vi.fn();
    await act(async () => {
      await expect(invoke('current-a', { onError })).rejects.toThrow('denied');
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe('current-a');
  });

  it('starts a same-account mutation when the screen unmounts immediately', async () => {
    hook = selected;
    const sent = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const current = fire;
    await act(async () => {
      current('old-a');
      root?.unmount();
      root = undefined;
      await Promise.resolve();
    });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('resumes an offline mutation after the screen unmounts while the account remains', async () => {
    hook = selected;
    const sent = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = sent as typeof fetch;
    onlineManager.setOnline(false);
    await act(async () => {
      root = create(React.createElement(App));
    });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && ['success', 'error'].includes(event.mutation.state.status))
        finish();
    });
    try {
      await act(async () => {
        fire('old-a');
        await Promise.resolve();
      });
      await act(async () => {
        show = false;
        root?.update(React.createElement(App));
      });
      await act(async () => {
        onlineManager.setOnline(true);
        await done;
      });
      expect(sent).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it.each(['B', 'ABA'] as const)(
    'does not resume an offline A mutation after unmount and observed %s bearer changes',
    async (transition) => {
      hook = selected;
      const sent = vi.fn();
      globalThis.fetch = sent as typeof fetch;
      onlineManager.setOnline(false);
      await act(async () => {
        root = create(React.createElement(App));
      });
      const outcome: { promise?: Promise<unknown> } = {};
      await act(async () => {
        outcome.promise = invoke('old-a').catch((error) => error);
      });
      await act(async () => {
        show = false;
        root?.update(React.createElement(App));
      });
      oxy.session.setAccessToken(jwt('B'));
      if (transition === 'ABA') oxy.session.setAccessToken(jwt('A', 'returned'));
      await act(async () => {
        onlineManager.setOnline(true);
        await outcome.promise;
      });
      expect(await outcome.promise).toMatchObject({ message: 'The active account changed' });
      expect(sent).not.toHaveBeenCalled();
    },
  );

  it('rejects a callback invoked for the first time after its screen unmounts', async () => {
    hook = selected;
    globalThis.fetch = vi.fn() as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const old = invoke;
    await act(async () => {
      show = false;
      root?.update(React.createElement(App));
    });
    await expect(old('old-a')).rejects.toThrow('active account changed');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('settles an already-sent mutation after unmount in the same account without UI callbacks', async () => {
    hook = selected;
    let deliver!: (value: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waiting = new Promise<Response>((resolve) => {
      deliver = resolve;
    });
    const sent = vi.fn(async () => {
      markStarted();
      return waiting;
    });
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const onSuccess = vi.fn();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const outcome: { promise?: Promise<unknown> } = {};
    await act(async () => {
      outcome.promise = invoke('old-a', { onSuccess });
      await started;
    });
    await act(async () => {
      show = false;
      root?.update(React.createElement(App));
    });
    await act(async () => {
      deliver(new Response(JSON.stringify({ success: true }), { status: 200 }));
      await outcome.promise;
    });
    await expect(outcome.promise).resolves.toEqual({ success: true });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'A'] });
  });

  it('does not invalidate A after unmount and a switch to B during an already-sent request', async () => {
    hook = selected;
    let deliver!: (value: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waiting = new Promise<Response>((resolve) => {
      deliver = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      markStarted();
      return waiting;
    }) as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const onSuccess = vi.fn();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const outcome: { promise?: Promise<unknown> } = {};
    await act(async () => {
      outcome.promise = invoke('old-a', { onSuccess }).catch((error) => error);
      await started;
    });
    await act(async () => {
      show = false;
      root?.update(React.createElement(App));
    });
    oxy.session.setAccessToken(jwt('B'));
    await act(async () => {
      deliver(new Response(JSON.stringify({ success: true }), { status: 200 }));
      await outcome.promise;
    });
    expect(await outcome.promise).toBeInstanceOf(Error);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('rejects a retained A callback after A to B to A while the new A callback works', async () => {
    hook = selected;
    const sent = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const oldHandler = invoke;
    await act(async () => {
      oxy.session.setAccessToken(jwt('B'));
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
    });
    await act(async () => {
      oxy.session.setAccessToken(jwt('A'));
      fixture.auth.user = { id: 'A' };
      fixture.auth.activeSessionId = 'session-A';
      root?.update(React.createElement(App));
    });
    await act(async () => {
      await expect(oldHandler('old-a')).rejects.toThrow('active account changed');
    });
    expect(sent).not.toHaveBeenCalled();
    await act(async () => {
      await invoke('new-a');
    });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('rejects a retained A callback when B is projected before the bearer changes', async () => {
    hook = selected;
    const sent = vi.fn();
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const oldHandler = invoke;
    await act(async () => {
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
    });
    await act(async () => {
      await expect(oldHandler('old-a')).rejects.toThrow('active account changed');
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it('does not send a mutation queued offline for A after switching to B', async () => {
    hook = selected;
    const sent = vi.fn();
    globalThis.fetch = sent as typeof fetch;
    onlineManager.setOnline(false);
    await act(async () => {
      root = create(React.createElement(App));
    });
    const failure: { promise?: Promise<unknown> } = {};
    await act(async () => {
      failure.promise = invoke('old-a').catch((error) => error);
    });
    await act(async () => {
      oxy.session.setAccessToken(jwt('B'));
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
      onlineManager.setOnline(true);
    });
    expect(await failure.promise).toMatchObject({ message: 'The active account changed' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('does not invoke A callbacks after an already-sent request completes under B', async () => {
    hook = selected;
    let deliver!: (value: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waiting = new Promise<Response>((resolve) => {
      deliver = resolve;
    });
    const sent = vi.fn(async () => {
      markStarted();
      return waiting;
    });
    globalThis.fetch = sent as typeof fetch;
    await act(async () => {
      root = create(React.createElement(App));
    });
    const success = vi.fn();
    const error = vi.fn();
    const settled = vi.fn();
    const invalidations = vi.spyOn(client, 'invalidateQueries');
    const outcome: { promise?: Promise<unknown> } = {};
    await act(async () => {
      outcome.promise = invoke('old-a', {
        onSuccess: success,
        onError: error,
        onSettled: settled,
      }).catch((reason: unknown) => reason);
      await started;
    });
    await act(async () => {
      oxy.session.setAccessToken(jwt('B'));
      fixture.auth.user = { id: 'B' };
      fixture.auth.activeSessionId = 'session-B';
      root?.update(React.createElement(App));
      deliver(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await outcome.promise;
    });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(invalidations).not.toHaveBeenCalled();
  });
});
