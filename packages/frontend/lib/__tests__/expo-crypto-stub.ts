/**
 * `expo-crypto` for node tests: its entry point reaches a native module, so
 * any module that mints an id (`lib/db/ids.ts`) is otherwise unreachable from
 * a node test. Only the platform boundary is replaced, by node's own Web
 * Crypto; the code under test is untouched.
 */
import { webcrypto } from 'node:crypto';

export function getRandomValues<T extends Uint8Array<ArrayBuffer>>(array: T): T {
  return webcrypto.getRandomValues(array);
}

export function randomUUID(): string {
  return webcrypto.randomUUID();
}
