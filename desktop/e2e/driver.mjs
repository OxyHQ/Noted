// A tiny WebDriver client for the desktop shell, through tauri-driver.
//
// Shared by the capability probe and the app-in-shell check. Plain `fetch` against
// the W3C WebDriver protocol, so CI needs no npm install.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:4444';

async function request(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json.value;
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(`${BASE}/status`);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('tauri-driver never came up');
}

/**
 * Start tauri-driver, open the shell at `application`, run `work`, and always shut
 * both down. `work` gets `run(script, args)` (execute a script in the page and
 * return its value) and `screenshot()` (a base64 PNG of the window).
 */
export async function withSession(application, work) {
  const driver = spawn('tauri-driver', [], { stdio: 'inherit' });
  driver.on('error', (error) => {
    console.error('could not start tauri-driver:', error.message);
    process.exit(1);
  });

  let sessionId;
  try {
    await waitForDriver();
    const session = await request('POST', '/session', {
      capabilities: { alwaysMatch: { 'tauri:options': { application } } },
    });
    sessionId = session.sessionId;
    return await work({
      run: (script, args = []) =>
        request('POST', `/session/${sessionId}/execute/sync`, { script, args }),
      screenshot: () => request('GET', `/session/${sessionId}/screenshot`),
    });
  } finally {
    if (sessionId) await request('DELETE', `/session/${sessionId}`).catch(() => undefined);
    driver.kill();
  }
}

export { sleep };
