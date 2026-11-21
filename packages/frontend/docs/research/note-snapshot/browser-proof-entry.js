import SQLite from 'expo-sqlite-web';
import { MIGRATIONS } from '../../../lib/db/migrations';
import { SNAPSHOT_SCHEMA, snapshotRefusedNote } from './index';
import { AudioArtifactStore } from '../../../lib/audio/artifact-store';
import { createChunkBackend, hasOpfs } from '../../../lib/audio/backend.web';
import { deleteCaptureAudio } from '../../../lib/audio/store';
const output = document.getElementById('result');
function check(condition, message) {
  if (!condition) throw new Error(message);
}
async function stmt(db, sql, params = []) {
  const s = new SQLite.NativeStatement();
  await db.prepareAsync(s, sql);
  try {
    return await s.runAsync(db, params, {}, true);
  } finally {
    await s.finalizeAsync(db);
  }
}
async function main() {
  check(hasOpfs(), 'OPFS unavailable');
  const store = new AudioArtifactStore(createChunkBackend());
  const writer = await store.open('capture', 'audio/wav');
  await writer.write(new Uint8Array([1, 2, 3, 4]));
  await writer.close();
  check((await store.readAll('capture'))[0].length === 4, 'audio fixture was not stored');
  const db = new SQLite.NativeDatabase('snapshot-proof.db', { useNewConnection: true });
  await db.initAsync();
  for (const migration of MIGRATIONS) for (const sql of migration) await db.execAsync(sql);
  for (const sql of SNAPSHOT_SCHEMA) await db.execAsync(sql);
  await db.execAsync(
    "INSERT INTO notes (id,title,created_at,updated_at,dirty) VALUES ('n','private','t','t',1); INSERT INTO outbox (entity,entity_id,op,next_attempt_at,created_at) VALUES ('note','n','upsert','t','t'); INSERT INTO captures (id,note_id,state,started_at,audio_path,created_at,updated_at) VALUES ('capture','n','complete','t','audio:capture','t','t');",
  );
  const id = (await stmt(db, 'SELECT id FROM outbox')).firstRowValues[0];
  await db.execAsync('BEGIN IMMEDIATE');
  for (const operation of snapshotRefusedNote('s', 'n', id, 't')) {
    const result = await stmt(db, operation.sql, operation.params);
    if (operation.expectedRowsAffected !== undefined)
      check(result.changes === operation.expectedRowsAffected, 'snapshot row count');
  }
  await db.execAsync('COMMIT');
  check(
    (await stmt(db, 'SELECT audio_path FROM research_snapshot_captures')).firstRowValues[0] ===
      'audio:capture',
    'missing captured ref',
  );
  await deleteCaptureAudio('audio:capture', 'capture');
  check((await store.describe('capture')) === null, 'OPFS audio still exists');
  check(
    (await stmt(db, 'SELECT audio_path FROM research_snapshot_captures')).firstRowValues[0] ===
      'audio:capture',
    'snapshot ref changed',
  );
  await db.closeAsync();
  output.textContent =
    'PASS: real OPFS audio removed while real SQLite snapshot retains the reference';
}
main()
  .catch((error) => {
    output.textContent = `FAIL: ${String(error?.stack || error)}`;
  })
  .finally(() => fetch('/report', { method: 'POST', body: output.textContent }));
