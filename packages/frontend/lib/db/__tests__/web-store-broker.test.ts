import { afterEach, expect, it, vi } from 'vitest';
import {
  createDatabaseBroker,
  DATABASE_LEADER_LOCK,
  type BrokerChannel,
  type DatabaseOperation,
  type DatabaseResult,
} from '../web-store-broker';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function platform() {
  const endpoints = new Set<{ listeners: Set<(event: { data: unknown }) => void> }>();
  let owner: string | null = null;
  const queued: { id: string; grant: () => void }[] = [];
  const lockNames: string[] = [];
  const calls: { sender: string; message: unknown }[] = [];
  return {
    calls,
    lockNames,
    channel(id: string): BrokerChannel {
      const endpoint = { listeners: new Set<(event: { data: unknown }) => void>() };
      endpoints.add(endpoint);
      return {
        postMessage(message) {
          calls.push({ sender: id, message });
          for (const peer of endpoints)
            if (peer !== endpoint)
              queueMicrotask(() => {
                for (const receive of peer.listeners) receive({ data: message });
              });
        },
        addEventListener(_type, listener) {
          endpoint.listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          endpoint.listeners.delete(listener);
        },
      };
    },
    locks(id: string) {
      return {
        request(name: string, callback: (lock: unknown) => Promise<void>): Promise<void> {
          lockNames.push(name);
          return new Promise<void>((resolve, reject) => {
            const grant = () => {
              owner = id;
              queueMicrotask(() => {
                void callback({ name }).then(resolve, reject);
              });
            };
            if (owner) queued.push({ id, grant });
            else {
              owner = id;
              grant();
            }
          });
        },
      };
    },
    destroyDocument(id: string) {
      if (owner === id) {
        owner = null;
        queued.shift()?.grant();
      } else {
        const index = queued.findIndex((entry) => entry.id === id);
        if (index >= 0) queued.splice(index, 1);
      }
    },
  };
}
const brokers: ReturnType<typeof createDatabaseBroker>[] = [];
afterEach(() => {
  for (const broker of brokers.splice(0)) broker.disconnect();
  vi.useRealTimers();
});
function makeBroker(
  id: string,
  browser: ReturnType<typeof platform>,
  dispatch: (viewer: string, operation: DatabaseOperation) => Promise<DatabaseResult>,
  timeoutMs = 1000,
) {
  const invalidate = vi.fn();
  const broker = createDatabaseBroker({
    id,
    channel: browser.channel(id),
    locks: browser.locks(id),
    dispatch,
    onInvalidate: invalidate,
    timeoutMs,
  });
  brokers.push(broker);
  return { broker, invalidate };
}
const read = { type: 'execute', sql: 'SELECT title FROM notes' } as const;
const write = {
  type: 'transaction',
  statements: [{ sql: 'UPDATE notes SET title = ?', params: ['Changed'], expectedRowsAffected: 1 }],
} as const;

it('does not retain completed SELECT snapshots when the transport delivers a duplicate read', async () => {
  const browser = platform();
  const dispatch = vi
    .fn()
    .mockResolvedValueOnce([{ title: 'Before' }])
    .mockResolvedValueOnce([{ title: 'After' }]);
  const owner = makeBroker('owner', browser, dispatch);
  owner.broker.setSession('alice', 1);
  expect(await owner.broker.call('alice', 1, read)).toEqual([{ title: 'Before' }]);
  const request = browser.calls.find(
    ({ message }) => (message as { kind: string }).kind === 'request',
  )!.message;
  browser.channel('duplicate-delivery').postMessage(request);
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
  const responses = browser.calls.filter(
    ({ message }) => (message as { kind: string }).kind === 'response',
  );
  expect(responses.at(-1)?.message).toMatchObject({ result: [{ title: 'After' }] });
});

it.each([
  { name: 'transaction', operation: write },
  {
    name: 'execute mutation',
    operation: { type: 'execute', sql: 'UPDATE notes SET title = ?', params: ['Changed'] } as const,
  },
  {
    name: 'unfamiliar SQL',
    operation: { type: 'execute', sql: 'PRAGMA user_version = 1' } as const,
  },
])('keeps same-request $name deduplicated', async ({ operation }) => {
  const browser = platform();
  const dispatch = vi.fn(async () => [1]);
  const owner = makeBroker('owner', browser, dispatch);
  owner.broker.setSession('alice', 1);
  await owner.broker.call('alice', 1, operation);
  const request = browser.calls.find(
    ({ message }) => (message as { kind: string }).kind === 'request',
  )!.message;
  browser.channel('duplicate-delivery').postMessage(request);
  await vi.waitFor(() =>
    expect(
      browser.calls.filter(({ message }) => (message as { kind: string }).kind === 'response'),
    ).toHaveLength(2),
  );
  expect(dispatch).toHaveBeenCalledOnce();
});

it('serves simultaneous owner and follower operations through one atomic dispatcher', async () => {
  const browser = platform();
  let running = 0,
    maximum = 0;
  const dispatch = vi.fn(async (_viewer: string, operation: DatabaseOperation) => {
    maximum = Math.max(maximum, ++running);
    await Promise.resolve();
    running--;
    return operation.type === 'transaction' ? [1] : [{ title: 'Changed' }];
  });
  const first = makeBroker('one', browser, dispatch);
  const followerDispatch = vi.fn(async () => []);
  const second = makeBroker('two', browser, followerDispatch);
  first.broker.setSession('alice', 1);
  second.broker.setSession('alice', 1);
  const results = await Promise.all([
    first.broker.call('alice', 1, write),
    second.broker.call('alice', 1, read),
  ]);
  expect(results).toEqual([[1], [{ title: 'Changed' }]]);
  expect(maximum).toBe(1);
  expect(followerDispatch).not.toHaveBeenCalled();
  expect(first.invalidate).toHaveBeenCalledWith('alice', new Set(['notes']));
  expect(second.invalidate).toHaveBeenCalledWith('alice', new Set(['notes']));
  expect(browser.lockNames.every((name) => name === DATABASE_LEADER_LOCK)).toBe(true);
});

it('keeps accounts isolated even when the owner is signed out', async () => {
  const browser = platform();
  const dispatch = vi.fn(async (viewer: string) => [{ title: `${viewer} private note` }]);
  const owner = makeBroker('owner', browser, dispatch);
  const alice = makeBroker(
    'alice-tab',
    browser,
    vi.fn(async () => []),
  );
  const bob = makeBroker(
    'bob-tab',
    browser,
    vi.fn(async () => []),
  );
  owner.broker.setSession(null, 2);
  alice.broker.setSession('alice', 1);
  bob.broker.setSession('bob', 1);
  const results = await Promise.all([
    alice.broker.call('alice', 1, read),
    bob.broker.call('bob', 1, read),
  ]);
  expect(results).toEqual([[{ title: 'alice private note' }], [{ title: 'bob private note' }]]);
  expect(dispatch.mock.calls.map(([viewer]) => viewer)).toEqual(['alice', 'bob']);
});

it('rejects queued requests and late results from an obsolete account generation', async () => {
  const browser = platform();
  const slow = deferred<DatabaseResult>();
  const dispatch = vi.fn(async () => slow.promise);
  const first = makeBroker('one', browser, dispatch);
  const second = makeBroker(
    'two',
    browser,
    vi.fn(async () => []),
  );
  first.broker.setSession('alice', 1);
  second.broker.setSession('alice', 1);
  const firstRequest = first.broker.call('alice', 1, read);
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  const pending = second.broker.call('alice', 1, write);
  const rejected = expect(pending).rejects.toThrow('active account changed');
  second.broker.setSession('bob', 2);
  await Promise.resolve();
  await Promise.resolve();
  slow.resolve([{ title: 'Alice note' }]);
  await firstRequest;
  await rejected;
  await Promise.resolve();
  await Promise.resolve();
  expect(dispatch).toHaveBeenCalledOnce();
});

it('never replays an unconfirmed committed write after owner death and refreshes on promotion', async () => {
  const browser = platform();
  const reply = deferred<DatabaseResult>();
  let committed = 0;
  const originalDispatch = vi.fn(async () => {
    committed++;
    return reply.promise;
  });
  const original = makeBroker('old-owner', browser, originalDispatch);
  const nextDispatch = vi.fn(async () => [{ title: `committed ${committed}` }]);
  const next = makeBroker('next-owner', browser, nextDispatch);
  original.broker.setSession('alice', 1);
  next.broker.setSession('alice', 1);
  const pending = next.broker.call('alice', 1, write);
  const rejected = expect(pending).rejects.toThrow('before the operation was confirmed');
  await vi.waitFor(() => expect(committed).toBe(1));
  original.broker.disconnect();
  browser.destroyDocument('old-owner');
  await rejected;
  expect(nextDispatch).not.toHaveBeenCalled();
  expect(next.invalidate).toHaveBeenCalledWith('alice', null);
  expect(await next.broker.call('alice', 1, read)).toEqual([{ title: 'committed 1' }]);
  reply.resolve([1]);
  expect(committed).toBe(1);
});

it('retries an in-flight startup SELECT once when its owner disappears', async () => {
  const browser = platform();
  const oldReply = deferred<DatabaseResult>();
  const oldDispatch = vi.fn(async () => oldReply.promise);
  const old = makeBroker('old', browser, oldDispatch);
  const nextDispatch = vi.fn(async () => [{ title: 'Current owner' }]);
  const next = makeBroker('next', browser, nextDispatch);
  old.broker.setSession('alice', 1);
  next.broker.setSession('alice', 1);
  const pending = next.broker.call('alice', 1, read);
  await vi.waitFor(() => expect(oldDispatch).toHaveBeenCalledOnce());
  old.broker.disconnect();
  browser.destroyDocument('old');
  await expect(pending).resolves.toEqual([{ title: 'Current owner' }]);
  expect(nextDispatch).toHaveBeenCalledExactlyOnceWith('alice', read);
  oldReply.resolve([{ title: 'Stale owner' }]);
});

it('bounds a read retry to one owner change', async () => {
  const browser = platform();
  const oldReply = deferred<DatabaseResult>(),
    nextReply = deferred<DatabaseResult>();
  const oldDispatch = vi.fn(async () => oldReply.promise);
  const nextDispatch = vi.fn(async () => nextReply.promise);
  const lastDispatch = vi.fn(async () => []);
  const old = makeBroker('old', browser, oldDispatch);
  const next = makeBroker('next', browser, nextDispatch);
  const last = makeBroker('last', browser, lastDispatch);
  for (const tab of [old, next, last]) tab.broker.setSession('alice', 1);
  const pending = last.broker.call('alice', 1, read);
  const rejected = expect(pending).rejects.toThrow('before the operation was confirmed');
  await vi.waitFor(() => expect(oldDispatch).toHaveBeenCalledOnce());
  old.broker.disconnect();
  browser.destroyDocument('old');
  await vi.waitFor(() => expect(nextDispatch).toHaveBeenCalledOnce());
  next.broker.disconnect();
  browser.destroyDocument('next');
  await rejected;
  expect(lastDispatch).not.toHaveBeenCalled();
  oldReply.resolve([]);
  nextReply.resolve([]);
});

it('preserves exact guarded-rollback errors and publishes no committed invalidation', async () => {
  const browser = platform();
  const failure = 'transaction statement 0 affected 0 rows; expected 1';
  const owner = makeBroker('owner', browser, async () => {
    throw new Error(failure);
  });
  owner.broker.setSession('alice', 1);
  await expect(owner.broker.call('alice', 1, write)).rejects.toThrow(failure);
  expect(owner.invalidate.mock.calls.filter(([, tables]) => tables !== null)).toEqual([]);
});

it('bounds an unresponsive owner without stealing its lock or replaying its request', async () => {
  vi.useFakeTimers();
  const browser = platform();
  const never = deferred<DatabaseResult>();
  const dispatch = vi.fn(async () => never.promise);
  const owner = makeBroker('owner', browser, dispatch, 50);
  const follower = makeBroker(
    'follower',
    browser,
    vi.fn(async () => []),
    50,
  );
  owner.broker.setSession('alice', 1);
  follower.broker.setSession('alice', 1);
  const pending = follower.broker.call('alice', 1, write);
  const rejected = expect(pending).rejects.toThrow('NOTED_BROKER_TIMEOUT');
  await vi.advanceTimersByTimeAsync(51);
  await rejected;
  expect(dispatch).toHaveBeenCalledOnce();
  expect(browser.lockNames).toHaveLength(2);
  never.resolve([1]);
});

it('discovers the current lock owner after clock rollback and ignores late old announcements', async () => {
  vi.useFakeTimers({ now: 10_000 });
  const browser = platform();
  const old = makeBroker('old', browser, async () => [{ title: 'old' }]);
  const next = makeBroker('next', browser, async () => [{ title: 'current' }]);
  old.broker.setSession('alice', 1);
  next.broker.setSession('alice', 1);
  expect(await next.broker.call('alice', 1, read)).toEqual([{ title: 'old' }]);
  const oldAnnouncement = browser.calls.find(
    ({ message }) =>
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === 'leader' &&
      !('client' in message),
  )!.message;
  vi.setSystemTime(100);
  old.broker.disconnect();
  browser.destroyDocument('old');
  await Promise.resolve();
  await Promise.resolve();
  expect(await next.broker.call('alice', 1, read)).toEqual([{ title: 'current' }]);
  browser.channel('late-delivery').postMessage(oldAnnouncement);
  await Promise.resolve();
  await Promise.resolve();
  expect(await next.broker.call('alice', 1, read)).toEqual([{ title: 'current' }]);
});
