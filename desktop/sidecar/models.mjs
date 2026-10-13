// The app's speech models, read from the app's own catalogue and fetched the way the
// app fetches them: from `packages/frontend/lib/stt/models.ts`, with the size and
// sha256 it records checked against what actually arrives.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function readModelRecord(id) {
  const source = readFileSync('packages/frontend/lib/stt/models.ts', 'utf8');
  const baseUrl = /const MODEL_BASE_URL = '([^']+)'/.exec(source)?.[1];
  const start = source.indexOf(`${id}: {`);
  if (start < 0) throw new Error(`no ${id} model in models.ts`);
  // Each model is one object literal; its block ends at the first closing `},`.
  const block = source.slice(start, source.indexOf('},', start));
  const filename = /filename: '([^']+)'/.exec(block)?.[1];
  const sha256 = /sha256: '([0-9a-f]{64})'/.exec(block)?.[1];
  const bytes = Number(/bytes: ([\d_]+)/.exec(block)?.[1]?.replaceAll('_', ''));
  if (!baseUrl || !filename || !sha256 || !bytes)
    throw new Error(`could not read ${id} from models.ts`);
  return { id, baseUrl, filename, sha256, bytes };
}

// The host rate-limits shared CI addresses (HTTP 429), so ask again, politely.
async function download(url) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5 * 2 ** attempt;
    console.log(`download answered ${response.status}; waiting ${wait}s`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
  throw new Error(`download failed: ${lastStatus}`);
}

/** Make sure `record`'s file is in `directory`, intact, and return its path. */
export async function fetchModel(record, directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, record.filename);
  if (!existsSync(path)) {
    console.log(`downloading ${record.filename} (${record.bytes} bytes)`);
    writeFileSync(path, await download(`${record.baseUrl}/${record.filename}`));
  } else {
    console.log(`using the cached ${record.filename}; it is still verified below`);
  }
  const weights = readFileSync(path);
  const digest = createHash('sha256').update(weights).digest('hex');
  console.log(`model: ${record.filename}  ${weights.length} bytes  sha256 ${digest}`);
  if (weights.length !== record.bytes) {
    throw new Error(`size ${weights.length} != ${record.bytes} recorded in models.ts`);
  }
  if (digest !== record.sha256) {
    throw new Error(`sha256 ${digest} != ${record.sha256} recorded in models.ts`);
  }
  return path;
}
