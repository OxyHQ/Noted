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

export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;

export async function digestStringAsync(_algorithm: string, input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
