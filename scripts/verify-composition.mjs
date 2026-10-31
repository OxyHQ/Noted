import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const baseURL = new URL(process.env.NOTED_URL || 'http://localhost:8147');
assert(
  ['localhost', '127.0.0.1'].includes(baseURL.hostname),
  'Only a local fixture server is allowed',
);
const output = path.resolve(process.env.PROBE_OUTPUT || '/tmp/noted-composition-audit');
fs.mkdirSync(output, { recursive: true });

const user = {
  id: 'noted-composition-synthetic',
  username: 'synthetic',
  name: { displayName: 'Synthetic notes', first: 'Synthetic', last: 'Notes' },
  language: 'en',
};
const notes = Array.from({ length: 32 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  title: `Synthetic note ${String(i + 1).padStart(2, '0')}`,
  blocks: Array.from({ length: i === 0 || i === 8 ? 50 : 3 }, (_, j) => ({
    id: `block-${i}-${j}`,
    parentBlockId: null,
    type: 'paragraph',
    content: {
      text: `Synthetic paragraph ${j + 1}. This fixture contains no personal information.`,
    },
    order: j,
  })),
  blocksVersion: 1,
  color: 'default',
  labels: [],
  folderId: null,
  pinned: false,
  archived: false,
  trashed: false,
  kind: 'note',
  attachments: [],
  removedAttachments: [],
  reminderAt: null,
  order: i,
  appData: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: 'light',
      serviceWorkers: 'block',
    });
    context.setDefaultTimeout(30_000);
    context.setDefaultNavigationTimeout(45_000);
    await context.addInitScript(
      ({ user }) => {
        const accessToken =
          btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) +
          '.' +
          btoa(
            JSON.stringify({
              sub: user.id,
              userId: user.id,
              sessionId: 'synthetic-session',
              exp: Math.floor(Date.now() / 1000) + 86400,
            }),
          ) +
          '.synthetic';
        localStorage.setItem(
          'oxy.auth.v1',
          JSON.stringify({
            sessionId: 'synthetic-session',
            userId: user.id,
            deviceId: 'synthetic-device',
            deviceSecret: 'synthetic-not-a-credential',
            accessToken,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          }),
        );
        localStorage.setItem(
          'oxy_session_boot_lane',
          JSON.stringify({ v: 1, clientId: 'composition-fixture', lane: 'device' }),
        );
        localStorage.setItem('oxy_session_boot_account', JSON.stringify({ v: 1, user }));
      },
      { user },
    );
    const requests = [];
    await context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin === baseURL.origin) return route.continue();
      requests.push({ method: request.method(), origin: url.origin, path: url.pathname });
      if (request.method() !== 'GET') return route.abort();
      if (url.hostname === 'oxy.invalid') {
        if (url.pathname === '/users/me') return route.fulfill({ json: user });
        if (url.pathname === '/accounts') return route.fulfill({ json: [] });
      }
      if (url.hostname === 'nilo.invalid') {
        if (url.pathname === '/notes/sync')
          return route.fulfill({
            json: {
              notes,
              deleted: [],
              labels: [],
              folders: [],
              cursor: 'synthetic-pass',
              hasMore: false,
              full: true,
              reset: false,
            },
          });
        if (url.pathname === '/notes/labels') return route.fulfill({ json: { labels: [] } });
        if (url.pathname === '/notes/folders') return route.fulfill({ json: { folders: [] } });
        if (url.pathname === '/notifications')
          return route.fulfill({ json: { notifications: [], unreadCount: 0 } });
      }
      return route.abort();
    });
    await context.routeWebSocket('**/*', (ws) => {
      const u = new URL(ws.url());
      if (u.hostname === baseURL.hostname && u.port === baseURL.port) ws.connectToServer();
      else ws.close();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.log('PAGEERROR', e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 500));
    });
    await page.goto(baseURL.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.getByText('Synthetic note 01', { exact: true }).waitFor({ timeout: 180000 });
    const samples = [];
    for (const width of [1280, 768, 767, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(900);
      samples.push(
        await page.evaluate(() => ({
          width: innerWidth,
          docWidth: document.documentElement.scrollWidth,
          docHeight: document.documentElement.scrollHeight,
          shell: document
            .querySelector('[data-testid="noted-app-shell"]')
            ?.getBoundingClientRect()
            .toJSON(),
        })),
      );
      await page.screenshot({ path: path.join(output, `notes-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(900);
    await page.mouse.move(1000, 500);
    await page.mouse.wheel(0, 480);
    await page.waitForTimeout(600);
    const positions = [{ step: 'notes before', y: await page.evaluate(() => scrollY) }];
    await page.screenshot({ path: path.join(output, 'notes-scrolled.png') });
    await page.getByText('Archive', { exact: true }).first().click();
    await page.waitForURL('**/archive');
    await page.waitForTimeout(800);
    positions.push({ step: 'archive arrive', y: await page.evaluate(() => scrollY) });
    await page.getByText('Notes', { exact: true }).first().click();
    await page.waitForURL(baseURL.href);
    await page.waitForTimeout(900);
    positions.push({ step: 'notes restored', y: await page.evaluate(() => scrollY) });
    await page.getByText('Synthetic note 09', { exact: true }).click();
    await page.waitForURL('**/n/**');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(output, 'editor.png') });
    const editor = await page.evaluate(() => ({
      url: location.pathname,
      documentOffset: scrollY,
      scrollers: Array.from(document.querySelectorAll('div'))
        .filter(
          (n) =>
            n.scrollHeight > n.clientHeight + 20 &&
            ['auto', 'scroll'].includes(getComputedStyle(n).overflowY),
        )
        .map((n) => ({
          testID: n.getAttribute('data-testid'),
          role: n.getAttribute('role'),
          height: n.clientHeight,
          scrollHeight: n.scrollHeight,
          rect: n.getBoundingClientRect().toJSON(),
        })),
    }));
    await page.mouse.move(800, 450);
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(600);
    const editorScrolled = await page.evaluate(() => ({
      documentOffset: scrollY,
      scrollers: Array.from(document.querySelectorAll('div'))
        .filter((n) => n.scrollTop > 0)
        .map((n) => ({
          testID: n.getAttribute('data-testid'),
          scrollTop: n.scrollTop,
          scrollHeight: n.scrollHeight,
          height: n.clientHeight,
        })),
    }));
    await page.keyboard.press('Escape');
    await page.waitForURL(baseURL.href);
    await page.waitForTimeout(1000);
    positions.push({ step: 'notes after editor', y: await page.evaluate(() => scrollY) });
    // Reopen and use a physical backdrop click, then exercise the same bounded editor at mobile width.
    await page.getByText('Synthetic note 09', { exact: true }).click();
    await page.waitForURL('**/n/**');
    await page.waitForTimeout(700);
    await page.mouse.click(20, 450);
    await page.waitForURL(baseURL.href);
    await page.waitForTimeout(700);
    positions.push({ step: 'notes after backdrop', y: await page.evaluate(() => scrollY) });
    await page.getByText('Synthetic note 09', { exact: true }).click();
    await page.waitForURL('**/n/**');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(1000);
    const mobileBefore = await page.evaluate(() => ({
      documentOffset: scrollY,
      docWidth: document.documentElement.scrollWidth,
    }));
    await page.mouse.move(200, 450);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(600);
    const mobileEditor = await page.evaluate(() => ({
      documentOffset: scrollY,
      docWidth: document.documentElement.scrollWidth,
      scrollers: Array.from(document.querySelectorAll('div'))
        .filter((n) => n.scrollTop > 0)
        .map((n) => ({
          scrollTop: n.scrollTop,
          height: n.clientHeight,
          scrollHeight: n.scrollHeight,
          width: n.clientWidth,
        })),
    }));
    await page.screenshot({ path: path.join(output, 'editor-mobile.png') });
    await page.keyboard.press('Escape');
    await page.waitForURL(baseURL.href);
    await page.waitForTimeout(700);
    const mobileAfter = await page.evaluate(() => ({
      documentOffset: scrollY,
      docWidth: document.documentElement.scrollWidth,
    }));
    const provenance = {
      consumer: process.env.CONSUMER_COMMIT || 'unrecorded',
      bloom: JSON.parse(
        fs.readFileSync(
          new URL('../node_modules/@oxy.so/bloom/package.json', import.meta.url),
          'utf8',
        ),
      ).version,
      platform: 'Chromium web only',
      network:
        'External requests denied except synthetic GET responses; WebSockets restricted to local Metro',
    };
    fs.writeFileSync(
      path.join(output, 'audit.json'),
      JSON.stringify(
        {
          provenance,
          errors,
          requests,
          samples,
          positions,
          editor,
          editorScrolled,
          mobileBefore,
          mobileEditor,
          mobileAfter,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    for (const sample of samples) {
      assert.equal(sample.docWidth, sample.width, 'No horizontal document overflow');
      assert(sample.docHeight > 900, 'Loaded notes grow the document');
    }
    assert.deepEqual(
      positions.map((p) => p.y),
      [480, 0, 480, 480, 480],
      'Routes and both editor dismissal paths preserve their document offsets',
    );
    assert.equal(editor.documentOffset, 480);
    assert.equal(editor.scrollers.length, 1, 'Editor has exactly one bounded scrolling body');
    assert.equal(
      editorScrolled.documentOffset,
      480,
      'Editor scrolling does not move the background document',
    );
    assert(
      editorScrolled.scrollers.some((s) => s.scrollTop >= 600),
      'Physical wheel reaches the editor body',
    );
    assert.equal(mobileEditor.docWidth, 390, 'Mobile editor has no horizontal overflow');
    assert.equal(
      mobileEditor.documentOffset,
      mobileBefore.documentOffset,
      'Mobile editor owns its scroll',
    );
    assert(
      mobileEditor.scrollers.some((s) => s.scrollTop > 0 && s.width <= 390),
      'Mobile editor body scrolls within its viewport',
    );
    assert.equal(mobileAfter.docWidth, 390);
    assert.equal(
      mobileAfter.documentOffset,
      mobileBefore.documentOffset,
      'Mobile dismissal preserves background position',
    );
    console.log({
      output,
      provenance,
      samples,
      positions,
      editor,
      editorScrolled,
      mobileEditor,
      mobileAfter,
    });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
