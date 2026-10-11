import { expect, test } from 'bun:test';

const entry = '../packages/frontend/worker/index.js';

test('assets pass through with their status, headers and body', async () => {
  const worker = (await import(entry)).default;
  const response = new Response('asset', {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public,max-age=31536000,immutable',
    },
  });
  const result = await worker.fetch(new Request('https://example.com/private-image.png'), {
    ASSETS: { fetch: async () => response },
  });
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toContain('immutable');
  expect(await result.text()).toBe('asset');
});

test('asset failures propagate the original error', async () => {
  const worker = (await import(entry)).default;
  const error = new Error('asset failure');
  await expect(
    worker.fetch(new Request('https://example.com/file.png'), {
      ASSETS: {
        fetch: async () => {
          throw error;
        },
      },
    }),
  ).rejects.toBe(error);
});

test('stale script requests still return 404 instead of the SPA HTML fallback', async () => {
  const worker = (await import(entry)).default;
  const result = await worker.fetch(new Request('https://example.com/_expo/static/stale.js'), {
    ASSETS: {
      fetch: async () =>
        new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }),
    },
  });
  expect(result.status).toBe(404);
});

test('SPA navigation routes keep the index.html fallback', async () => {
  const worker = (await import(entry)).default;
  const result = await worker.fetch(new Request('https://example.com/notes/abc'), {
    ASSETS: {
      fetch: async () =>
        new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }),
    },
  });
  expect(result.status).toBe(200);
  expect(await result.text()).toBe('<html>app</html>');
});
