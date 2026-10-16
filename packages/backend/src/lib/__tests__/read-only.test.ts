import { describe, expect, it } from 'bun:test';
import express from 'express';

import { MOVED_TO_NILO, refuseWrites } from '../read-only.js';

async function serve() {
  const app = express();
  app.use('/notes', refuseWrites);
  app.all('/notes', (_req, res) => {
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe('refuseWrites', () => {
  it('lets a read through and refuses every write with MOVED_TO_NILO', async () => {
    const { base, close } = await serve();
    try {
      expect((await fetch(`${base}/notes`)).status).toBe(200);
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        const res = await fetch(`${base}/notes`, { method });
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBe('86400');
        expect(await res.json()).toEqual(MOVED_TO_NILO);
      }
    } finally {
      close();
    }
  });
});
