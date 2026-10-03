import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotedClient } from '../noted-client';

let server: Server;
let baseURL: string;
const requests: { path: string; bearer: string | undefined; method: string | undefined; body: string }[] = [];
const envelope = { data: [{ id: 'note-B' }], deleted: ['note-deleted'], serverTime: '2026-10-03T12:00:00.000Z' };

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    requests.push({ path: req.url!, bearer: req.headers.authorization, method: req.method, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/slow-body') {
      res.writeHead(200);
      res.write('{"pending":');
      return;
    }
    if (req.url === '/gone') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Note already deleted' }));
      return;
    }
    if (req.url === '/denied') {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    if (req.url === '/refresh' && req.headers.authorization === `Bearer ${jwt('A')}`) {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    res.end(JSON.stringify(envelope));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

// Synthetic session state drives the real SDK; the HTTP server is not an Oxy verifier.
function jwt(id: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: id, exp: 2_000_000_000 })}.fixture`;
}

function fixture(timeout?: number) {
  const oxy = new OxyServices({ baseURL });
  const client = createNotedClient(oxy, baseURL, timeout);
  return { oxy, client };
}

describe('Noted domain requests through the linked SDK', () => {
  it('preserves data, deleted and serverTime plus encoded query, following session changes', async () => {
    const { oxy, client } = fixture();
    try {
      oxy.session.setAccessToken(jwt('A'));
      expect(await client.get('/notes/sync', { params: { since: '2026-10-03T12:00:00+03:00' } })).toEqual({ data: envelope });
      expect(requests.at(-1)?.bearer).toBe(`Bearer ${jwt('A')}`);
      expect(new URL(requests.at(-1)!.path, baseURL).searchParams.get('since')).toBe('2026-10-03T12:00:00+03:00');
      oxy.session.setAccessToken(jwt('B'));
      expect(await client.get('/notes/sync')).toEqual({ data: envelope });
      expect(requests.at(-1)?.bearer).toBe(`Bearer ${jwt('B')}`);
      oxy.session.clear();
      const count = requests.length;
      await expect(client.get('/notes/sync')).rejects.toThrow('active Oxy session');
      expect(requests).toHaveLength(count);
    } finally { client.dispose(); }
  });

  it('denies before transport with no session', async () => {
    const { client } = fixture();
    try {
      const count = requests.length;
      await expect(client.post('/notes', { id: 'note' })).rejects.toThrow('active Oxy session');
      expect(requests).toHaveLength(count);
    } finally { client.dispose(); }
  });

  it('delegates one 401 refresh to the SDK and preserves write/error bodies', async () => {
    const { oxy, client } = fixture();
    try {
      oxy.session.setAccessToken(jwt('A'));
      let refreshes = 0;
      oxy.http.setAuthRefreshHandler(async () => { refreshes += 1; return jwt('B'); });
      const before = requests.length;
      expect(await client.post('/refresh', { id: 'note-B' })).toEqual({ data: envelope });
      expect(refreshes).toBe(1);
      expect(requests.slice(before).map(({ body }) => body)).toEqual(['{"id":"note-B"}', '{"id":"note-B"}']);
      expect(requests.at(-1)?.bearer).toBe(`Bearer ${jwt('B')}`);
      await expect(client.delete('/gone')).rejects.toMatchObject({ response: { status: 404, data: { error: 'Note already deleted' } } });
      const deniedBefore = requests.length;
      await expect(client.get('/denied')).rejects.toMatchObject({ response: { status: 403 } });
      expect(requests).toHaveLength(deniedBefore + 1);
    } finally { client.dispose(); }
  });

  it('bounds response-body reading with the same deadline and does not retry a write', async () => {
    const { oxy, client } = fixture(50);
    try {
      oxy.session.setAccessToken(jwt('A'));
      const before = requests.length;
      await expect(client.post('/slow-body', { id: 'note-B' })).rejects.toThrow();
      expect(requests).toHaveLength(before + 1);
    } finally { client.dispose(); }
  });
});
