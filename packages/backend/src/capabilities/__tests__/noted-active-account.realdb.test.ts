import { spawn } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestDatabase, dropTestDatabase } from '@oxy.so/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Only the central introspection boundary is synthetic. The product factory,
// published MCP transport, token validation and SQL handlers run unchanged.
const authority = vi.hoisted(() => ({ active: true }));
vi.mock('@oxy.so/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oxy.so/mcp')>();
  return {
    ...actual,
    createCatalogMcpHttpService: (
      options: Parameters<typeof actual.createCatalogMcpHttpService>[0],
    ) => {
      const {
        getServiceToken,
        invalidateServiceToken,
        introspectionEndpoint,
        introspectToken,
        ...transport
      } = options;
      void getServiceToken;
      void invalidateServiceToken;
      void introspectionEndpoint;
      void introspectToken;
      return actual.createCatalogMcpHttpService({
        ...transport,
        introspectToken: async () => {
          if (!authority.active) return null;
          const now = Math.floor(Date.now() / 1000);
          return {
            iss: options.authorizationServer,
            sub: 'fixture-requester',
            aud: options.catalog.audience,
            resource: options.catalog.externalMcp!.resource,
            client_id: 'fixture-client',
            jti: 'fixture-token',
            iat: now,
            exp: now + 60,
            account_id: 'account-A',
            scope: 'notes.read',
            connection: {
              connection_id: 'fixture-connection',
              origin_account_id: 'account-A',
              active_account_id: 'account-B',
              accounts: ['account-A', 'account-B'].map((account_id) => ({
                account_id,
                is_origin: account_id === 'account-A',
                linked_at: new Date().toISOString(),
              })),
            },
          };
        },
      });
    },
  };
});

import { closePostgres, connectPostgres, getDb } from '../../db/postgres.js';
import { labels } from '../../db/schema/labels.js';
import { notes } from '../../db/schema/notes.js';
import { createNotedMcpHttpService } from '../noted-mcp-http.js';
import { NOTED_CAPABILITY_CATALOG } from '../noted.catalog.js';

let databaseUrl: string | undefined;
let server: Server | undefined;
let origin: string;
let noteA: typeof notes.$inferSelect;
let noteB: typeof notes.$inferSelect;
let labelB: typeof labels.$inferSelect;
const unexpectedFetch = vi.fn(async () => {
  throw new Error('Unexpected outbound fetch in isolated fixture');
});

beforeAll(async () => {
  vi.stubGlobal('fetch', unexpectedFetch);
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl)
    throw new Error('TEST_DATABASE_URL is required for the disposable PostgreSQL fixture');
  databaseUrl = await createTestDatabase({
    adminUrl,
    migrate: async (url) => {
      const target = new URL(url).pathname.slice(1);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'bun',
          ['run', 'db:migrate', `--target-database=${target}`, '--phase=all'],
          {
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_URL: url },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        child.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });
        child.stderr.on('data', (data: Buffer) => {
          output += data.toString();
        });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`Migration exit ${String(code)}: ${output}`)),
        );
      });
    },
  });
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv('OXY_API_URL', 'https://api.oxy.so');
  const db = await connectPostgres();
  [noteA, noteB] = await db
    .insert(notes)
    .values([
      { oxyUserId: 'account-A', title: 'Private A', body: 'A body' },
      { oxyUserId: 'account-B', title: 'Private B', body: 'B body' },
    ])
    .returning();
  const insertedLabels = await db
    .insert(labels)
    .values([
      { oxyUserId: 'account-A', name: 'A label' },
      { oxyUserId: 'account-B', name: 'B label' },
    ])
    .returning();
  labelB = insertedLabels[1];
  const service = createNotedMcpHttpService();
  server = createServer((req, res) => {
    void service.handleMcp(req, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  await closePostgres();
  if (databaseUrl) await dropTestDatabase(databaseUrl);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  expect(unexpectedFetch).not.toHaveBeenCalled();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(
      `${origin}/mcp`,
      {
        method: 'POST',
        headers: {
          host: new URL(NOTED_CAPABILITY_CATALOG.externalMcp!.resource).host,
          authorization: 'Bearer fixture-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    );
  });
}

describe('Noted OAuth origin A → active B with real SQL ownership', () => {
  it('lists only B notes and labels through the product MCP wrappers', async () => {
    const result = await call('searchNotes');
    expect(result.status).toBe(200);
    expect(result.body.result.isError).not.toBe(true);
    expect(
      result.body.result.structuredContent.notes.map((note: { id: string }) => note.id),
    ).toEqual([noteB.id]);
    const labelsResult = await call('listLabels');
    expect(
      labelsResult.body.result.structuredContent.labels.map((label: { id: string }) => label.id),
    ).toEqual([labelB.id]);
  });

  it('reads B and refuses the origin account A private note', async () => {
    const allowed = await call('readNote', { noteId: noteB.id });
    expect(allowed.body.result.structuredContent.note.id).toBe(noteB.id);
    const refused = await call('readNote', { noteId: noteA.id });
    expect(refused.body.result.isError).toBe(true);
    expect(JSON.stringify(refused.body)).not.toContain('A body');
  });

  it('checks central activity on the next invocation without altering product rows', async () => {
    authority.active = false;
    const refused = await call('readNote', { noteId: noteB.id });
    expect(refused.status).toBe(401);
    expect(await getDb().select().from(notes)).toHaveLength(2);
    authority.active = true;
    expect(
      (await call('readNote', { noteId: noteB.id })).body.result.structuredContent.note.id,
    ).toBe(noteB.id);
  });
});
