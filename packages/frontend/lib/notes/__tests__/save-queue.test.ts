import { describe, expect, it } from 'vitest';
import { NoteSaveQueue } from '../save-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('editor local save lifecycle', () => {
  it('creates once and retains edits made before the initial write completes', async () => {
    const firstWrite = deferred();
    let id: string | null = null;
    const writes: string[] = [];
    const queue = new NoteSaveQueue<string>(async (body) => {
      if (!id) {
        writes.push(`create:${body}`);
        await firstWrite.promise;
        id = 'note';
      } else {
        writes.push(`update:${id}:${body}`);
      }
    });
    const created = queue.save('first');
    const edited = queue.save('first and second');
    await Promise.resolve();
    expect(writes).toEqual(['create:first']);
    firstWrite.resolve();
    await Promise.all([created, edited]);
    expect(writes).toEqual(['create:first', 'update:note:first and second']);
  });

  it('lets a later edit retry a failed save', async () => {
    const writes: string[] = [];
    const queue = new NoteSaveQueue<string>(async (body) => {
      writes.push(body);
      if (writes.length === 1) throw new Error('disk full');
    });
    await expect(queue.save('first')).rejects.toThrow('disk full');
    await queue.save('edited');
    expect(writes).toEqual(['first', 'edited']);
  });

  it('does not report a final save complete before earlier writes land', async () => {
    const pending = deferred();
    let count = 0;
    const queue = new NoteSaveQueue<string>(async () => {
      count++;
      if (count === 1) await pending.promise;
    });
    void queue.save('typing');
    let canClose = false;
    const close = queue.save('final').then(() => {
      canClose = true;
    });
    await Promise.resolve();
    expect(canClose).toBe(false);
    pending.resolve();
    await close;
    expect(canClose).toBe(true);
    expect(count).toBe(2);
  });
});

describe('leaving an editor account', () => {
  it('cancels work waiting behind a save when the editor unmounts', async () => {
    const pending = deferred();
    const writes: string[] = [];
    const queue = new NoteSaveQueue<string>(async (body) => {
      writes.push(body);
      await pending.promise;
    });
    const first = queue.save('first account');
    const second = queue.save('queued private edit');
    await Promise.resolve();
    queue.cancelPending();
    const rejected = expect(second).rejects.toThrow('editor was closed');
    pending.resolve();
    await first;
    await rejected;
    expect(writes).toEqual(['first account']);
  });
});
