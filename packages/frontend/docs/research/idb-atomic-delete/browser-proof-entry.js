import { AudioArtifactStore } from '../../../lib/audio/artifact-store';
import { createChunkBackend, hasOpfs } from '../../../lib/audio/backend.web';
import { deleteCaptureAudio } from '../../../lib/audio/store';
const output = document.getElementById('result');
function check(ok, message) {
  if (!ok) throw new Error(message);
}
async function main() {
  Object.defineProperty(navigator.storage, 'getDirectory', {
    value: undefined,
    configurable: true,
  });
  check(!hasOpfs() && typeof indexedDB !== 'undefined', 'did not select IndexedDB');
  const backend = createChunkBackend();
  const store = new AudioArtifactStore(backend);
  for (const id of ['capture', 'other']) {
    const w = await store.open(id, 'audio/wav');
    await w.write(new Uint8Array([1, 2, 3, 4]));
    await w.write(new Uint8Array([5, 6]));
    await w.close();
  }
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (key) {
    if (this.name === 'manifests')
      throw new DOMException('injected second delete failure', 'UnknownError');
    return original.call(this, key);
  };
  let error;
  try {
    await deleteCaptureAudio('audio:capture', 'capture');
  } catch (e) {
    error = e;
  } finally {
    IDBObjectStore.prototype.delete = original;
  }
  check(
    error && String(error).includes('injected second delete failure'),
    'deletion did not report failure',
  );
  check((await backend.indices('capture')).length === 2, 'rollback lost the capture chunk');
  check((await backend.readManifest('capture')) !== null, 'rollback lost manifest');
  check(
    (await backend.read('capture', 0)).join(',') === '1,2,3,4' &&
      (await backend.read('capture', 1)).join(',') === '5,6',
    'rollback changed bytes',
  );
  const original2 = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (key) {
    const request = original2.call(this, key);
    if (this.name === 'chunks')
      request.addEventListener('success', () => request.transaction.abort());
    return request;
  };
  error = undefined;
  try {
    await deleteCaptureAudio('audio:capture', 'capture');
  } catch (e) {
    error = e;
  } finally {
    IDBObjectStore.prototype.delete = original2;
  }
  check(error, 'abort after success was not reported');
  check((await backend.indices('capture')).length === 2, 'abort lost the capture chunk');
  check((await backend.readManifest('capture')) !== null, 'abort lost manifest');
  check(
    (await backend.read('capture', 0)).join(',') === '1,2,3,4' &&
      (await backend.read('capture', 1)).join(',') === '5,6',
    'abort changed bytes',
  );
  await deleteCaptureAudio('audio:capture', 'capture');
  check((await backend.indices('capture')).length === 0, 'success retained capture chunk');
  check((await backend.readManifest('capture')) === null, 'success retained manifest');
  check((await backend.indices('other')).length === 2, 'success touched other capture');
  check((await backend.readManifest('other')) !== null, 'success touched other manifest');
  await deleteCaptureAudio('audio:capture', 'capture');
  output.textContent =
    'PASS: synchronous setup failure and abort roll back both stores; success deletes only target and is repeatable';
}
main()
  .catch((error) => {
    output.textContent = `FAIL: ${String(error?.stack || error)}`;
  })
  .finally(() => fetch('/report', { method: 'POST', body: output.textContent }));
