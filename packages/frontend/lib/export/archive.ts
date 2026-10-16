/**
 * Every note as one archive of Markdown files.
 *
 * Built on `noteToMarkdown` and `noteFilename`, so a note in the archive is
 * byte for byte the file a single export would produce.
 */

import type { LocalNote as Note } from '@/lib/db/notes-repo';
import { noteFilename, noteToMarkdown } from './markdown';
import { createZip, type ZipEntry } from './zip';

/**
 * Filenames made unique within one archive.
 *
 * Two notes titled "Ideas" would otherwise share a name, and an unzip tool
 * either overwrites the first or asks, which is how a note quietly goes
 * missing from a backup.
 */
export function uniqueFilenames(notes: readonly Note[]): string[] {
  const seen = new Set<string>();
  return notes.map((note) => {
    const base = noteFilename(note);
    let candidate = base;
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) {
      candidate = base.replace(/\.md$/, ` (${n}).md`);
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

export function notesToArchive(notes: readonly Note[], now?: Date): Uint8Array {
  const names = uniqueFilenames(notes);
  const entries: ZipEntry[] = notes.map((note, i) => ({
    name: names[i] as string,
    contents: noteToMarkdown(note),
  }));
  return createZip(entries, now);
}
