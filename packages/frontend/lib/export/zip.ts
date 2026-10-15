/**
 * A zip archive, written by hand.
 *
 * Entries are stored rather than deflated. The payload is Markdown a person
 * keeps, not something sent over a wire, and a stored archive is a few dozen
 * lines with no dependency to ship on every platform — every unzip tool reads
 * it. Pure, so the format is tested byte for byte.
 */

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  contents: string;
}

const encoder = new TextEncoder();

/** Bit 11: the file name and contents are UTF-8, not the legacy code page. */
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is all a zip header can say. Clamped to 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const stamp = dosDateTime(now);
  const files = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.contents);
    return { name, data, crc: crc32(data) };
  });

  const localSize = files.reduce((sum, f) => sum + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((sum, f) => sum + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  let offset = 0;
  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true); // version needed
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 8, 0, true); // method: stored
    view.setUint16(offset + 10, stamp.time, true);
    view.setUint16(offset + 12, stamp.date, true);
    view.setUint32(offset + 14, f.crc, true);
    view.setUint32(offset + 18, f.data.length, true);
    view.setUint32(offset + 22, f.data.length, true);
    view.setUint16(offset + 26, f.name.length, true);
    view.setUint16(offset + 28, 0, true); // extra length
    out.set(f.name, offset + 30);
    out.set(f.data, offset + 30 + f.name.length);
    offset += 30 + f.name.length + f.data.length;
  }

  const centralStart = offset;
  files.forEach((f, i) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true); // version made by
    view.setUint16(offset + 6, 20, true); // version needed
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, stamp.time, true);
    view.setUint16(offset + 14, stamp.date, true);
    view.setUint32(offset + 16, f.crc, true);
    view.setUint32(offset + 20, f.data.length, true);
    view.setUint32(offset + 24, f.data.length, true);
    view.setUint16(offset + 28, f.name.length, true);
    // extra, comment, disk number, internal and external attributes stay 0
    view.setUint32(offset + 42, offsets[i] as number, true);
    out.set(f.name, offset + 46);
    offset += 46 + f.name.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, files.length, true);
  view.setUint16(offset + 10, files.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}
