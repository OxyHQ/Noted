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
    if (req.url === '/html-gone' || req.url === '/text-denied' || req.url === '/malformed-ok') {
      res.writeHead(req.url === '/html-gone' ? 404 : req.url === '/text-denied' ? 403 : 200, { 'Content-Type': 'text/html' });
      res.end('<html>upstream unavailable</html>');
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
function jwt(id: string, nonce = 'initial', exp = 2_000_000_000): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: id, sessionId: `session-${id}`, nonce, exp })}.fixture`;
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
      oxy.http.setAuthRefreshHandler(async () => { refreshes += 1; return jwt('A', 'renewed'); });
      const before = requests.length;
      expect(await client.post('/refresh', { id: 'note-B' }, { expectedViewerId: 'A' })).toEqual({ data: envelope });
      expect(refreshes).toBe(1);
      expect(requests.slice(before).map(({ body }) => body)).toEqual(['{"id":"note-B"}', '{"id":"note-B"}']);
      expect(requests.at(-1)?.bearer).toBe(`Bearer ${jwt('A', 'renewed')}`);
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

it.each([['/html-gone', 404], ['/text-denied', 403]] as const)('preserves known HTTP status for non-JSON %s', async (path, status) => {
  const { oxy, client } = fixture();
  try {
    oxy.session.setAccessToken(jwt('A'));
    await expect(client.get(path)).rejects.toMatchObject({ message: `Request failed with status ${status}`, response: { status, data: null } });
  } finally { client.dispose(); }
});
it('still refuses a malformed successful JSON body', async () => {
  const { oxy, client } = fixture();
  try {
    oxy.session.setAccessToken(jwt('A'));
    await expect(client.get('/malformed-ok')).rejects.toThrow();
  } finally { client.dispose(); }
});

it.each(['preflight', 'response-401'] as const)('enforces the Noted deadline while %s is pending', async (phase) => {
  const { oxy, client } = fixture(30);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    oxy.session.setAccessToken(phase === 'preflight' ? jwt('A', 'initial', Math.floor(Date.now() / 1000) + 10) : jwt('A'));
    oxy.http.setAuthRefreshHandler(async () => { entered(); await gate; return jwt('A', 'renewed'); });
    const before = requests.length;
    const outcome = client.post('/refresh', { id: 'same-note' }).then(() => ({ unexpected: 'response' }), (error: unknown) => ({ error }));
    await ready;
    const bounded = await Promise.race([outcome, new Promise<{ pending: true }>((resolve) => { timer = setTimeout(() => resolve({ pending: true }), 150); })]);
    expect(bounded).toMatchObject({ error: { code: 'CANCELLED' } });
    expect(requests).toHaveLength(before + (phase === 'preflight' ? 0 : 1));
    release();
    await oxy.http.refreshAccessToken(phase);
    await outcome;
    expect(requests).toHaveLength(before + (phase === 'preflight' ? 0 : 1));
  } finally { clearTimeout(timer); release(); client.dispose(); }
});

it('rejects an old-account operation before sending under a different bearer', async () => {
  const { oxy, client } = fixture();
  try {
    oxy.session.setAccessToken(jwt('B'));
    const before = requests.length;
    await expect(client.post('/notes', { title: 'Alice private note' }, { expectedViewerId: 'A' })).rejects.toThrow('active account changed');
    expect(requests).toHaveLength(before);
  } finally { client.dispose(); }
});

it.each(['preflight', 'response-401'] as const)('aborts old-account work during %s instead of sending it as the next account', async phase => {
  const { oxy, client } = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  try {
    oxy.session.setAccessToken(phase === 'preflight' ? jwt('A', 'initial', Math.floor(Date.now() / 1000) + 10) : jwt('A'));
    oxy.http.setAuthRefreshHandler(async () => { entered(); await gate; return jwt('B', 'renewed'); });
    const before = requests.length;
    const outcome = client.post('/refresh', { title: 'Alice private note' }, { expectedViewerId: 'A' }).catch(error => error);
    await ready;
    oxy.session.setAccessToken(jwt('B'));
    release();
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(requests.slice(before)).toHaveLength(phase === 'preflight' ? 0 : 1);
    expect(requests.slice(before).every(request => request.bearer === `Bearer ${jwt('A')}`)).toBe(true);
  } finally { release(); client.dispose(); }
});
