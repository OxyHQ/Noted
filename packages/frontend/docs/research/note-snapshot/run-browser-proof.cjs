/* Standalone browser research fixture; does not read or write a user database. */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error('Set CHROME_PATH to a Chromium executable');
const frontend = path.resolve(__dirname, '../../..');
const workspace = path.resolve(frontend, '../..');
const sqlite = path.dirname(require.resolve('expo-sqlite/package.json', { paths: [frontend] }));
const esbuild = path.join(workspace, 'node_modules/.bin/esbuild');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-opfs-snapshot-proof-'));
const expoStub = path.join(scratch, 'expo-stub.js');
const loggerStub = path.join(scratch, 'logger-stub.js');
fs.writeFileSync(
  expoStub,
  'export class NativeModule { emit() {} }\nexport function registerWebModule(Klass) { return new Klass(); }\nexport class UnavailabilityError extends Error {}\n',
);
fs.writeFileSync(
  loggerStub,
  'export function createLogger() { return {info(){},warn(){},error(){},debug(){}} }\n',
);
fs.writeFileSync(
  path.join(scratch, 'index.html'),
  '<!doctype html><html><body><pre id="result">RUNNING</pre><script src="/bundle.js"></script></body></html>',
);
function build(args) {
  const result = spawnSync(esbuild, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`esbuild failed: ${result.stderr}`);
}
build([
  path.join(sqlite, 'web/worker.ts'),
  '--bundle',
  '--platform=browser',
  '--format=iife',
  '--loader:.wasm=file',
  '--define:__DEV__=false',
  `--outfile=${scratch}/worker`,
]);
build([
  path.join(__dirname, 'browser-proof-entry.js'),
  '--bundle',
  '--platform=browser',
  '--format=iife',
  `--alias:expo-sqlite-web=${sqlite}/web/SQLiteModule.ts`,
  `--alias:expo=${expoStub}`,
  `--alias:@oxy.so/core/logger=${loggerStub}`,
  `--alias:@=${frontend}`,
  '--define:__DEV__=false',
  `--outfile=${scratch}/bundle.js`,
]);
let chrome;
const server = http.createServer((req, res) => {
  if (req.url === '/report' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      console.log(body);
      if (!body.startsWith('PASS:')) process.exitCode = 1;
      res.end('ok');
      clearTimeout(timeout);
      chrome?.kill();
      server.close();
    });
    return;
  }
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return res.writeHead(404).end();
  const file = path.join(scratch, name);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader(
    'Content-Type',
    name.endsWith('.wasm')
      ? 'application/wasm'
      : name.endsWith('.html')
        ? 'text/html'
        : 'application/javascript',
  );
  res.end(fs.readFileSync(file));
});
const timeout = setTimeout(() => {
  console.error('Timed out waiting for browser report');
  process.exitCode = 1;
  chrome?.kill();
  server.close();
}, 30_000);
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  chrome = spawn(
    chromePath,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${scratch}/profile`,
      `http://127.0.0.1:${port}/`,
    ],
    { stdio: 'ignore' },
  );
  chrome.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
    clearTimeout(timeout);
    server.close();
  });
});
