/**
 * Note ids, minted on the device.
 *
 * A note created offline needs an id before any server has seen it, and that id
 * has to survive the upload unchanged — screens, links and the outbox are all
 * already using it. The server therefore accepts a client-supplied id, which
 * means it has to be the same kind of value the server would have generated:
 * a UUIDv7, which is what `@oxyhq/db`'s `generatedId()` produces for every
 * primary key in the Postgres schema.
 *
 * v7 rather than v4 because the first 48 bits are the timestamp, so ids sort by
 * creation time. That keeps inserts appending to the end of the primary key's
 * index instead of scattering across it.
 */

import * as Crypto from 'expo-crypto';

function randomBytes(count: number): Uint8Array {
  return Crypto.getRandomValues(new Uint8Array(count));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * A new UUIDv7: 48-bit big-endian millisecond timestamp, then version and
 * variant bits, then randomness.
 */
export function newNoteId(): string {
  const bytes = randomBytes(16);
  const timestamp = Date.now();

  // 48-bit timestamp, most significant byte first.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Whether a string is a UUIDv7 — the only id shape this app's notes use. */
export function isNoteId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
