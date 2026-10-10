import { afterEach, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  setActiveViewer: vi.fn().mockResolvedValue(undefined),
  execute: vi.fn().mockResolvedValue([{ title: 'Before freezing' }]),
  executeTransaction: vi.fn(),
}));
vi.mock('../client-engine', () => engine);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('refreshes live reads on resume even if the document stays hidden', async () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('crypto', { randomUUID: () => 'resuming-tab' });
  vi.stubGlobal('BroadcastChannel', class extends EventTarget { postMessage() {} });
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, callback: (lock: object) => Promise<void>) => callback({}) },
  });
  const client = await import('../client.web');
  await client.setActiveViewer('alice');
  const onData = vi.fn();
  const unsubscribe = await client.subscribe('SELECT title FROM notes', [], { onData });
  await vi.advanceTimersByTimeAsync(20);
  expect(onData).toHaveBeenLastCalledWith([{ title: 'Before freezing' }]);

  engine.execute.mockClear().mockResolvedValue([{ title: 'Edited in another tab' }]);
  document.dispatchEvent(new Event('resume'));
  await vi.advanceTimersByTimeAsync(20);
  expect(document.visibilityState).toBe('hidden');
  expect(onData).toHaveBeenLastCalledWith([{ title: 'Edited in another tab' }]);
  expect(engine.execute).toHaveBeenCalledExactlyOnceWith('SELECT title FROM notes', [], 'alice');
  expect(engine.executeTransaction).not.toHaveBeenCalled();
  unsubscribe();
});
